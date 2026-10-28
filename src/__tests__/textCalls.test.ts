import { textCallRevision } from '../textCalls.js';

/** The pass asked for an answer that wrote a tool call as text. */

const TOOLS = ['readSkill', 'newProject', 'editRecord', 'buildProject', 'deployProject', 'healthcheck'];

describe('textCallRevision', () => {
    it('asks for the call written as text, once per run', () => {
        // Eval round 69's npc #1, the whole answer.
        const answer = 'I will start by reviewing the modding basics and then the specific skill for NPCs.\n\n' +
            'First, I am reading the Skyrim modding basics skill.\n\n<tool_call>readSkill{skill:skyrim-modding-basics}</tool_call>';

        const revision = textCallRevision(answer, 'run-1')!;

        expect(revision.action).toBe('revise');
        expect(revision.reason).toBe('The answer wrote a tool call as text: readSkill{skill:skyrim-modding-basics}.');
        expect(revision.retry.instruction).toContain('— readSkill{skill:skyrim-modding-basics} — and text runs nothing');
        expect(revision.retry.instruction).toMatch(/Make it as a tool call now, then go on with the task\.$/);
        expect(revision.retry).toMatchObject({ idempotencyKey: 'skyrim-modding-tools:text-call:run-1', maxAttempts: 1 });
    });

    it('reads the call form of a model\'s tool-call tokens, and a name with no arguments', () => {
        expect(textCallRevision('<|tool_call>call:buildProject{project:<|"|>FlameBlade<|"|>}<tool_call|>', 'r')!.reason)
            .toBe('The answer wrote a tool call as text: buildProject{project:<|"|>FlameBlade<|"|>}.');
        expect(textCallRevision('<tool_call>healthcheck</tool_call>', 'r')!.reason).toBe('The answer wrote a tool call as text: healthcheck.');
    });

    it('reads the other tags a call was written in, the first call of several', () => {
        // Eval round 65's sword+detailed #2 and #5, the whole answers.
        const calls = 'I will start by reading the necessary modding skills to ensure I follow the correct conventions for creating ' +
            'weapons and enchantments in Skyrim SE.\n\n<call>readSkill{skill:skyrim-modding-basics}</call>\n' +
            '<call>readSkill{skill:skyrim-modding-items-and-crafting}</call>\n<call>readSkill{skill:skyrim-modding-magic}</call>';
        expect(textCallRevision(calls, 'r', TOOLS)!.reason).toBe('The answer wrote a tool call as text: readSkill{skill:skyrim-modding-basics}.');
        const code = 'I will begin by reading the `skyrim-modding-basics` skill to ensure I follow the correct workflow for creating a ' +
            'new mod.\n\n<tool_code>\nreadSkill{skill: "skyrim-modding-basics"}\n</tool_code>';
        expect(textCallRevision(code, 'r', TOOLS)!.reason).toBe('The answer wrote a tool call as text: readSkill{skill: "skyrim-modding-basics"}.');
    });

    it('reads an answer that ends on one of the agent\'s tools written as a call, and asks for it as a call meant to run', () => {
        // Eval round 76's spell+detailed #1 and npc #1, the whole answers.
        const json = 'I will start by consulting the relevant skills to ensure I follow the correct procedures for creating a ' +
            'Destruction spell.\n\nFirst, I\'ll read the modding basics, and then I\'ll look at the specific guidance for magic ' +
            'spells.\n\n[Tool Call]\n{\n  "tool_name": "readSkill",\n  "tool_args": {\n    "skill": "skyrim-modding-basics"\n  }\n}';
        const json76 = textCallRevision(json, 'r', TOOLS)!;
        expect(json76.reason).toBe('The answer wrote a tool call as text: { "tool_name": "readSkill", "tool_args": { "skill": "skyrim-modding-basics" } }.');
        expect(json76.retry.instruction).toMatch(/If you meant it to run, make it as a tool call now, then go on with the task; if you wrote it for the user to read, answer as you did\.$/);
        const searched = 'I will start by reviewing the necessary modding skills to ensure I create the NPC correctly, and then I will ' +
            'proceed with creating the project, adding the NPC, and building the mod.\n\nFirst, I am reading the basic modding ' +
            'guide:\n\nopenclaw_tool_call{id: "readSkill", args: {skill: "skyrim-modding-basics"}}';
        expect(textCallRevision(searched, 'r', TOOLS)!.reason)
            .toBe('The answer wrote a tool call as text: openclaw_tool_call{id: "readSkill", args: {skill: "skyrim-modding-basics"}}.');
        expect(textCallRevision('Next:\n```\nprint(default_api.newProject(project="FlameBlade"))\n```', 'r', TOOLS)!.reason)
            .toBe('The answer wrote a tool call as text: newProject(project="FlameBlade").');
    });

    it('leaves a call named in an answer that goes on past it, a name not the agent\'s, and an answer without one', () => {
        expect(textCallRevision('I changed it with editRecord {"project": "FlameBlade", "record": "Weapons/FlameBlade.yaml"} and ' +
            'built it: buildProject answered success.', 'r', TOOLS)).toBeUndefined();
        expect(textCallRevision('The sword is done.\n\n{"name": "Flame Blade", "damage": 12}', 'r', TOOLS)).toBeUndefined();
        expect(textCallRevision('Call it like this: makeSword{name: "Flame Blade"}', 'r', TOOLS)).toBeUndefined();
        expect(textCallRevision('Built FlameBlade.esp: C:\\projects\\FlameBlade\\build\\FlameBlade.esp. Nothing is left to do.', 'r', TOOLS)).toBeUndefined();
        expect(textCallRevision(undefined, 'r', TOOLS)).toBeUndefined();
        expect(textCallRevision('<tool_call>readSkill{}</tool_call>', undefined, TOOLS)).toBeUndefined();
    });
});
