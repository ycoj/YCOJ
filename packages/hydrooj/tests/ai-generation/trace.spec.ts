import assert from 'assert';
import { describe, it } from 'node:test';
import { STATUS } from '@hydrooj/common';
import {
    AiGenerationTrace, aiTraceStatus, serializeAiTraceMessage,
} from '../../src/lib/aiGeneration/trace';

describe('AI generation trace schema', () => {
    it('serializes one event as one JSON line', () => {
        const line = serializeAiTraceMessage({
            schema: 'hydro.ai-generation.trace',
            version: 1,
            seq: 1,
            type: 'tool',
            state: 'running',
            startedAt: '2026-08-16T00:00:00.000Z',
            data: { summary: 'python3 generator.py\n' },
        });
        assert.doesNotMatch(line, /\r|\n/);
        assert.deepEqual(JSON.parse(line), {
            schema: 'hydro.ai-generation.trace',
            version: 1,
            seq: 1,
            type: 'tool',
            state: 'running',
            startedAt: '2026-08-16T00:00:00.000Z',
            data: { summary: 'python3 generator.py\n' },
        });
    });

    it('maps event states to Hydro testcase statuses', () => {
        assert.equal(aiTraceStatus('tool', 'running'), STATUS.STATUS_JUDGING);
        assert.equal(aiTraceStatus('tool', 'succeeded'), STATUS.STATUS_ACCEPTED);
        assert.equal(aiTraceStatus('validation', 'failed'), STATUS.STATUS_FORMAT_ERROR);
        assert.equal(aiTraceStatus('tool', 'cancelled'), STATUS.STATUS_CANCELED);
        assert.equal(aiTraceStatus('tool', 'timed_out'), STATUS.STATUS_TIME_LIMIT_EXCEEDED);
        assert.equal(aiTraceStatus('tool', 'failed'), STATUS.STATUS_SYSTEM_ERROR);
    });
});

describe('AI generation trace persistence', () => {
    it('updates the same testcase when an event completes', async () => {
        const updates: any[] = [];
        const broadcasts: any[] = [];
        const trace = new AiGenerationTrace({
            async append(testcase) {
                updates.push({ testcase });
                broadcasts.push(testcase);
                return testcase;
            },
            async update(id, set) {
                updates.push({ id, set });
                broadcasts.push(set);
                return set;
            },
        });
        const handle = await trace.start('tool', { tool: 'Read' });
        await trace.finish(handle, 'succeeded', { tool: 'Read' });

        assert.equal(updates.length, 2);
        assert.equal(updates[0].testcase.id, handle.id);
        assert.equal(updates[0].testcase.status, STATUS.STATUS_JUDGING);
        assert.equal(updates[1].id, handle.id);
        assert.equal(updates[1].set['testCases.$.status'], STATUS.STATUS_ACCEPTED);
        assert.equal(typeof updates[1].set['testCases.$.time'], 'number');
        const message = JSON.parse(updates[1].set['testCases.$.message']);
        assert.equal(message.seq, handle.id);
        assert.equal(message.state, 'succeeded');
        assert.equal(broadcasts.length, 2);
    });
});
