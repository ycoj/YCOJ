import type { AiModelRuntimeConfig } from '../runtime';
import { GoJudgeSessionClient } from './session';

export interface AiAgentEvent {
    phase: 'tool-start' | 'tool-end';
    toolCallId: string;
    tool: string;
    summary: string;
    details?: Record<string, any>;
    error?: string;
    failed?: boolean;
}

const MAX_TOOL_ERROR_TEXT = 4_096;

function textResult(text: string, details: any) {
    return { content: [{ type: 'text' as const, text }], details };
}

function summarizeTool(tool: string, args: any) {
    if (tool === 'Read') return String(args?.path || '');
    if (tool === 'Edit') return String(args?.path || '');
    if (tool === 'Shell') {
        return String(args?.command || '').trim();
    }
    return '';
}

function summarizeToolResult(tool: string, result: any) {
    const details = result?.details || {};
    if (tool === 'Read') return `${details.lines || 0}/${details.totalLines || 0} line(s)`;
    if (tool === 'Edit') return `${details.bytes || 0} byte(s)`;
    if (tool === 'Shell') return String(details.command || '').trim();
    return '';
}

function toolResultDetails(tool: string, result: any): Record<string, any> {
    const details = result?.details || {};
    if (tool === 'Read') {
        return {
            path: details.path,
            offset: details.offset,
            lines: details.lines,
            totalLines: details.totalLines,
            truncated: !!details.truncated,
        };
    }
    if (tool === 'Edit') return { path: details.path, bytes: details.bytes };
    if (tool === 'Shell') {
        return {
            commandLength: String(details.command || '').length,
            status: details.status,
            exitStatus: details.exitStatus,
            time: details.time,
            memory: details.memory,
            runTime: details.runTime,
        };
    }
    return {};
}

function boundedToolError(result: any) {
    const content = Array.isArray(result?.content) ? result.content : [];
    let text = '';
    for (const block of content) {
        if (block?.type !== 'text' || typeof block.text !== 'string') continue;
        const prefix = text ? '\n' : '';
        const remaining = MAX_TOOL_ERROR_TEXT - text.length - prefix.length;
        if (remaining <= 0) break;
        text += `${prefix}${block.text.slice(0, remaining)}`;
    }
    return text || undefined;
}

export function createSessionTools(
    client: GoJudgeSessionClient, sessionId: string, Type: any,
): any[] {
    const readSchema = Type.Object({
        path: Type.String({ description: 'Relative workspace path' }),
        offset: Type.Optional(Type.Integer({ minimum: 1, description: 'First line, 1-based' })),
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 2000, description: 'Maximum lines' })),
    });
    const editSchema = Type.Object({
        path: Type.String({ description: 'Relative workspace path' }),
        oldText: Type.String({ minLength: 1, description: 'Exact text occurring exactly once' }),
        newText: Type.String({ description: 'Replacement text' }),
    });
    const shellSchema = Type.Object({
        command: Type.String({ minLength: 1, maxLength: 16384 }),
        timeoutSeconds: Type.Optional(Type.Integer({ minimum: 1, maximum: 120 })),
    });

    const Read = {
        name: 'Read',
        label: 'Read',
        description: 'Read a UTF-8 file in the persistent sandbox workspace by relative path, with optional line offset and limit.',
        parameters: readSchema,
        executionMode: 'sequential',
        async execute(_toolCallId, params, signal) {
            const result = await client.readText(sessionId, params.path, params.offset, params.limit, undefined, signal);
            const suffix = result.truncated
                ? `\n[Showing ${result.lines} line(s) from ${result.offset}; ${result.totalLines} total. Output truncated.]`
                : '';
            return textResult(`${result.content}${suffix}`, {
                path: params.path, offset: result.offset, lines: result.lines, totalLines: result.totalLines, truncated: result.truncated,
            });
        },
    };
    const Edit = {
        name: 'Edit',
        label: 'Edit',
        description: 'Replace exactly one unique occurrence of text in a UTF-8 workspace file. Fails when the text is absent or ambiguous.',
        parameters: editSchema,
        executionMode: 'sequential',
        async execute(_toolCallId, params, signal) {
            const original = (await client.readFile(sessionId, params.path, signal)).toString('utf8');
            const first = original.indexOf(params.oldText);
            if (first < 0) throw new Error(`Edit target was not found in ${params.path}.`);
            if (original.includes(params.oldText, first + 1)) {
                throw new Error(`Edit target is not unique in ${params.path}.`);
            }
            const updated = `${original.slice(0, first)}${params.newText}${original.slice(first + params.oldText.length)}`;
            await client.writeFile(sessionId, params.path, updated, signal);
            return textResult(`Updated ${params.path}.`, { path: params.path, bytes: Buffer.byteLength(updated) });
        },
    };
    const Shell = {
        name: 'Shell',
        label: 'Shell',
        description: 'Run a command through /bin/sh -lc inside the persistent, network-isolated sandbox workspace.',
        parameters: shellSchema,
        executionMode: 'sequential',
        async execute(_toolCallId, params, signal) {
            const seconds = params.timeoutSeconds || 30;
            const result = await client.execShell(sessionId, params.command, signal, {
                cpuLimit: Math.min(seconds, 60) * 1_000_000_000,
                clockLimit: seconds * 1_000_000_000,
            });
            const output = [
                `status: ${result.status}`,
                `exitStatus: ${result.exitStatus}`,
                result.stdout ? `stdout:\n${result.stdout}` : '',
                result.stderr ? `stderr:\n${result.stderr}` : '',
                result.error ? `error:\n${result.error}` : '',
            ].filter(Boolean).join('\n');
            return textResult(output, {
                command: String(params.command || '').trim(),
                status: result.status,
                exitStatus: result.exitStatus,
                time: result.time,
                memory: result.memory,
                runTime: result.runTime,
            });
        },
    };
    return [Read, Edit, Shell];
}

function finalAssistantText(agent: any) {
    const message = [...agent.state.messages].reverse().find((item: any) => item.role === 'assistant') as any;
    if (!message) return '';
    return message.content
        .filter((block: any) => block.type === 'text')
        .map((block: any) => block.text)
        .join('\n')
        .trim();
}

export interface AiAgentRunner {
    prompt(text: string): Promise<string>;
    abort(): void;
}

export async function createAiAgent(
    config: AiModelRuntimeConfig, client: GoJudgeSessionClient, sandboxSessionId: string,
    providerSessionId: string, systemPrompt: string,
    onEvent?: (event: AiAgentEvent) => Promise<void> | void,
): Promise<AiAgentRunner> {
    const load = (specifier: string): Promise<any> => import(specifier);
    const [{ Agent: PiAgent }, ai, apiModule] = await Promise.all([
        load('@earendil-works/pi-agent-core'),
        load('@earendil-works/pi-ai'),
        config.apiType === 'openai-responses'
            ? load('@earendil-works/pi-ai/api/openai-responses.lazy')
            : load('@earendil-works/pi-ai/api/openai-completions.lazy'),
    ]);
    const providerId = config.providerId || 'ai-generation';
    const baseUrl = config.baseUrl.replace(/\/+$/, '');
    const model = {
        id: config.model,
        name: config.model,
        api: config.apiType,
        provider: providerId,
        baseUrl,
        reasoning: config.reasoning,
        input: ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: config.contextTokens,
        maxTokens: config.maxTokens,
    };
    const provider = ai.createProvider({
        id: providerId,
        name: config.providerName || 'AI testdata generation',
        baseUrl,
        auth: {
            apiKey: {
                name: 'AI generation API key',
                resolve: async ({ signal }) => {
                    signal.throwIfAborted();
                    return config.apiKey ? { auth: { apiKey: config.apiKey }, source: 'Hydro AI provider configuration' } : undefined;
                },
            },
        },
        models: [model],
        api: config.apiType === 'openai-responses'
            ? apiModule.openAIResponsesApi()
            : apiModule.openAICompletionsApi(),
    });
    const models = ai.createModels();
    models.setProvider(provider);
    const agent = new PiAgent({
        initialState: {
            systemPrompt,
            model,
            thinkingLevel: config.reasoning ? config.thinkingLevel : 'off',
            tools: createSessionTools(client, sandboxSessionId, ai.Type),
            messages: [],
        },
        streamFn: models.streamSimple.bind(models),
        sessionId: providerSessionId,
        toolExecution: 'sequential',
    });
    let eventUpdates = Promise.resolve();
    agent.subscribe((event: any) => {
        let update: AiAgentEvent | undefined;
        if (event.type === 'tool_execution_start') {
            update = {
                phase: 'tool-start',
                toolCallId: event.toolCallId,
                tool: event.toolName,
                summary: summarizeTool(event.toolName, event.args),
            };
        } else if (event.type === 'tool_execution_end') {
            const failed = event.isError === true;
            update = {
                phase: 'tool-end',
                toolCallId: event.toolCallId,
                tool: event.toolName,
                summary: failed ? 'tool execution error' : summarizeToolResult(event.toolName, event.result),
                details: toolResultDetails(event.toolName, event.result),
                error: failed ? boundedToolError(event.result) : undefined,
                failed,
            };
        }
        if (update && onEvent) {
            eventUpdates = eventUpdates
                .then(() => onEvent(update))
                .catch(() => undefined)
                .then(() => undefined);
        }
        // Deliberately ignore thinking and text streaming events. The final response is returned only to the caller.
    });
    return {
        async prompt(text: string) {
            await agent.prompt(text);
            await eventUpdates;
            if (agent.state.errorMessage) throw new Error(agent.state.errorMessage);
            return finalAssistantText(agent);
        },
        abort: () => agent.abort(),
    };
}
