import { announcedStep, announcedStepRevision, textCallRevision } from '../textCalls.js';

/** The passes asked for an answer that wrote a tool call as text, or announced a step and made no call. */

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

describe('announcedStepRevision', () => {
    it('asks for the step an answer announced, once per run', () => {
        // Eval round 79's npc #1, the whole answer.
        const answer = '[[reply_to_current]]I will start by reading the essential modding guides, specifically for general modding ' +
            'basics and then for creating NPCs, to ensure I follow all conventions before starting the project.\n\n' +
            'First, I am reading the Skyrim Modding Basics skill.\n';

        const revision = announcedStepRevision(answer, 'run-1')!;

        expect(revision.action).toBe('revise');
        expect(revision.reason).toBe('The answer announced a step and made no call: First, I am reading the Skyrim Modding Basics skill.');
        expect(revision.retry.instruction).toContain('— "First, I am reading the Skyrim Modding Basics skill." — but no tool call came with it');
        expect(revision.retry.instruction).toMatch(/If you meant to do it now, make the call, then go on with the task; if you were answering the user, answer as you did\.$/);
        expect(revision.retry).toMatchObject({ idempotencyKey: 'skyrim-modding-tools:announced-step:run-1', maxAttempts: 1 });
    });

    it('reads the ways a step is announced', () => {
        for (const step of ['I will create the project HildaTheNord now.', 'I\'ll read the NPC skill first:', 'Now I\'m reading the basics.',
            'Let me look up a vanilla Nord woman.', 'Let\'s start with reading the skills.', 'Okay, I am going to build it.',
            'The skills come first. **Next, I will read them.**']) {
            expect(announcedStep(step)).toBeDefined();
        }
    });

    it('leaves an answer that ends otherwise: done, waiting for the user, or asking them', () => {
        for (const answer of [
            'The mod is built and ready. Let me know if you would like to deploy it.',
            'The project is built. I will wait for your go before deploying it.',
            '**Next Step:** I am awaiting your instruction to deploy the mod.',
            'Built HildaTheNord.esp. Shall I deploy it? I\'ll be glad to.',
            'Should I deploy it now? I will need your word first?',
            'A FormID is a record\'s number in the load order.',
            'I made Hilda, a female Nord, and built the project.'
        ]) {
            expect(announcedStep(answer)).toBeUndefined();
        }
        expect(announcedStepRevision(undefined, 'r')).toBeUndefined();
        expect(announcedStepRevision('I will read the skill.', undefined)).toBeUndefined();
    });
});
