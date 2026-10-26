import { textCallRevision } from '../textCalls.js';

/** The pass asked for an answer that wrote a tool call as text. */

describe('textCallRevision', () => {
    it('asks for the call written as text, once per run', () => {
        // Eval round 69's npc #1, the whole answer.
        const answer = 'I will start by reviewing the modding basics and then the specific skill for NPCs.\n\n' +
            'First, I am reading the Skyrim modding basics skill.\n\n<tool_call>readSkill{skill:skyrim-modding-basics}</tool_call>';

        const revision = textCallRevision(answer, 'run-1')!;

        expect(revision.action).toBe('revise');
        expect(revision.reason).toBe('The answer wrote a tool call as text: readSkill{skill:skyrim-modding-basics}.');
        expect(revision.retry.instruction).toContain('— readSkill{skill:skyrim-modding-basics} — and text runs nothing');
        expect(revision.retry).toMatchObject({ idempotencyKey: 'skyrim-modding-tools:text-call:run-1', maxAttempts: 1 });
    });

    it('reads the call form of gemma4\'s tokens, and a name with no arguments', () => {
        expect(textCallRevision('<|tool_call>call:buildProject{project:<|"|>FlameBlade<|"|>}<tool_call|>', 'r')!.reason)
            .toBe('The answer wrote a tool call as text: buildProject{project:<|"|>FlameBlade<|"|>}.');
        expect(textCallRevision('<tool_call>healthcheck</tool_call>', 'r')!.reason).toBe('The answer wrote a tool call as text: healthcheck.');
    });

    it('leaves an answer without one, and a run it cannot name', () => {
        expect(textCallRevision('Built FlameBlade.esp: C:\\projects\\FlameBlade\\build\\FlameBlade.esp. Nothing is left to do.', 'r')).toBeUndefined();
        expect(textCallRevision(undefined, 'r')).toBeUndefined();
        expect(textCallRevision('<tool_call>readSkill{}</tool_call>', undefined)).toBeUndefined();
    });
});
