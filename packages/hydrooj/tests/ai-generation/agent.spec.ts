import assert from 'assert';
import { describe, it } from 'node:test';
import { createSessionTools } from '../../src/lib/aiGeneration/agent';
import type { GoJudgeSessionClient } from '../../src/lib/aiGeneration/session';

describe('Pi faux provider ReAct loop', () => {
    it('executes only Session-backed tools and never persists thinking', async () => {
        const [{ Agent }, ai] = await Promise.all([
            import('@earendil-works/pi-agent-core'),
            import('@earendil-works/pi-ai'),
        ]);
        const files = new Map<string, Buffer>([
            ['problem.md', Buffer.from('# Sum\n')],
            ['generator.py', Buffer.from('print("weak")\n')],
        ]);
        const calls: string[] = [];
        const session = {
            async readText(_sessionId, path) {
                calls.push(`read:${path}`);
                const content = files.get(path).toString();
                return { content, offset: 1, lines: 1, totalLines: 1, truncated: false };
            },
            async readFile(_sessionId, path) {
                return files.get(path);
            },
            async writeFile(_sessionId, path, content) {
                calls.push(`edit:${path}`);
                files.set(path, Buffer.from(content));
            },
            async execShell(_sessionId, command) {
                calls.push(`shell:${command}`);
                return {
                    status: 'Accepted', exitStatus: 0, time: 1, memory: 1, runTime: 1, stdout: 'generated\n', stderr: '', error: '',
                };
            },
        } as unknown as GoJudgeSessionClient;

        const faux = ai.fauxProvider({
            models: [{ id: 'test-model', reasoning: true, contextWindow: 128_000, maxTokens: 4096 }],
        });
        const models = ai.createModels();
        models.setProvider(faux.provider);
        faux.setResponses([
            ai.fauxAssistantMessage([
                ai.fauxThinking('private chain of thought'),
                ai.fauxToolCall('Read', { path: 'problem.md' }),
            ], { stopReason: 'toolUse' }),
            ai.fauxAssistantMessage(ai.fauxToolCall('Edit', {
                path: 'generator.py', oldText: 'weak', newText: 'strong',
            }), { stopReason: 'toolUse' }),
            ai.fauxAssistantMessage(ai.fauxToolCall('Shell', {
                command: 'python3 generator.py', timeoutSeconds: 10,
            }), { stopReason: 'toolUse' }),
            ai.fauxAssistantMessage('Generated and validated adversarial test data.'),
        ]);

        const persisted: string[] = [];
        const agent = new Agent({
            initialState: {
                systemPrompt: 'Generate strong contest data.',
                model: faux.getModel(),
                thinkingLevel: 'high',
                tools: createSessionTools(session, 'sess', ai.Type),
            },
            streamFn: models.streamSimple.bind(models),
            toolExecution: 'sequential',
        });
        agent.subscribe((event) => {
            if (event.type === 'tool_execution_start') persisted.push(`${event.toolName} started`);
            if (event.type === 'message_update' && event.assistantMessageEvent.type === 'text_delta') {
                persisted.push(event.assistantMessageEvent.delta);
            }
        });
        await agent.prompt('Generate now.');

        assert.deepEqual(calls, [
            'read:problem.md',
            'edit:generator.py',
            'shell:python3 generator.py',
        ]);
        assert.match(files.get('generator.py').toString(), /strong/);
        assert.equal(faux.state.callCount, 4);
        assert.equal(faux.getPendingResponseCount(), 0);
        assert.match(persisted.join(''), /Generated and validated/);
        assert.doesNotMatch(persisted.join(''), /private chain of thought/);
    });
});
