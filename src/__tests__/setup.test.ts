import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { WizardPrompter } from 'openclaw/plugin-sdk/setup-runtime';
import { MUDDY } from 'skyrim-modding-tools-core';
import {
    applySetup, askSetup, defaultsPrompter, findMuddy, muddyTools, setupSummary, type Config, type SetupContext, type SetupFlags
} from '../setup.js';

/** `openclaw skyrim setup`: the questions asked, and what the answers write into OpenClaw's config. */

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

function tempDir(): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skyrim-setup-'));
    roots.push(root);
    return root;
}

function write(file: string, text = ''): void {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
}

/** A Mod Organizer instance for Skyrim, as Mod Organizer writes one, in a global instances folder. */
function instance(instancesDir: string, name: string): string {
    const game = path.join(path.dirname(instancesDir), `game-${name}`);
    const dir = path.join(instancesDir, name);
    write(path.join(game, 'SkyrimSE.exe'));
    write(path.join(dir, 'ModOrganizer.ini'), ['[General]', 'gameName=Skyrim Special Edition',
        `gamePath=@ByteArray(${game.replace(/\\/g, '\\\\')})`, 'selected_profile=@ByteArray(Default)', ''].join('\r\n'));
    write(path.join(dir, 'profiles', 'Default', 'modlist.txt'));
    return dir;
}

/**
 * A prompter answering from a script: each question takes the first unused answer whose pattern its message matches,
 * and a question the script has no answer for fails the test. Notes are kept.
 */
function scripted(answers: [RegExp, unknown][]) {
    const left = [...answers];
    const asked: string[] = [];
    const notes: string[] = [];
    const answer = async (params: { message: string }) => {
        asked.push(params.message);
        const index = left.findIndex(([pattern]) => pattern.test(params.message));
        if (index < 0) throw new Error(`Not in the script: ${params.message}`);
        return left.splice(index, 1)[0]![1];
    };
    const prompter = {
        ...defaultsPrompter(() => { }),
        note: async (message: string) => { notes.push(message); },
        select: answer, text: answer, confirm: answer
    } as unknown as WizardPrompter;
    return { prompter, asked, notes, left };
}

/** OpenClaw with one agent and Ollama serving one model, another installed; a Windows profile with MO2's folder. */
function setup(config: Config = {}) {
    const root = tempDir();
    const local = path.join(root, 'AppData', 'Local');
    const context: SetupContext = {
        config: {
            agents: { defaults: { model: { primary: 'ollama/small:4b' } }, entries: { main: { workspace: path.join(root, 'workspace') } } },
            models: { providers: { ollama: { baseUrl: 'http://127.0.0.1:11434', models: [{ id: 'small:4b', contextWindow: 131072, contextTokens: 131072 }] } } },
            ...config
        },
        settingsEnv: {},
        env: { LOCALAPPDATA: local },
        root,
        stateDir: path.join(root, '.openclaw'),
        projectsDir: path.join(root, '.openclaw', 'skyrim-modding-tools', 'projects'),
        platform: 'win32',
        ollamaModels: async () => ['small:4b', 'bigger:12b']
    };
    return { root, instancesDir: path.join(local, 'ModOrganizer'), context };
}

const nothingThere = () => false;

async function run(context: SetupContext, prompter: WizardPrompter, flags: SetupFlags = {}) {
    const choices = await askSetup(prompter, context, flags, nothingThere);
    const draft: Config = structuredClone(context.config);
    applySetup(draft, choices, context);
    return { choices, draft };
}

describe('setting the tools up', () => {
    it('offers the instances found, and sets Muddy up with a model Ollama has, at the context picked', async () => {
        const { instancesDir, context } = setup();
        const test = instance(instancesDir, 'Skyrim Test');
        instance(instancesDir, 'LoreRim');
        const { prompter } = scripted([
            [/Which Mod Organizer instance/, test],
            [/Nexus Mods API key/, ''],
            [/Set up Muddy/, true],
            [/Which model/, 'ollama/bigger:12b'],
            [/keep in mind/, 32768],
            [/How long should Muddy think/, 'medium'],
            [/learn from his work/, true]
        ]);
        const { draft } = await run(context, prompter);

        expect(draft.plugins.entries['skyrim-modding-tools']).toEqual({
            config: { mo2Instance: test, agents: [MUDDY.id] },
            hooks: { allowConversationAccess: true }
        });
        expect(draft.models.providers.ollama.models).toContainEqual({ id: 'bigger:12b', name: 'bigger:12b', contextTokens: 32768 });
        const muddy = draft.agents.entries[MUDDY.id];
        expect(muddy).toMatchObject({
            name: 'Muddy',
            identity: { name: 'Muddy', emoji: '🦀', avatar: 'avatars/mudcrab.png' },
            workspace: path.join(context.stateDir, 'workspace-muddy'),
            cwd: context.projectsDir,
            model: { primary: 'ollama/bigger:12b', fallbacks: [] },
            thinkingDefault: 'medium',
            tools: { allow: muddyTools(true) }
        });
        expect(muddy.skills).toEqual(expect.arrayContaining(['skyrim-modding-basics', 'skyrim-modding-crash-analysis']));
        expect(draft.agents.entries.main).toEqual(context.config.agents.entries.main);
    });

    it('asks again after a folder that is no instance, saying why', async () => {
        const { root, instancesDir, context } = setup();
        const portable = instance(path.join(root, 'Portable'), 'MO2');
        const { prompter, notes } = scripted([
            [/Which Mod Organizer instance/, 'other'],
            [/instance folder/, path.join(root, 'nothing')],
            [/Which Mod Organizer instance/, 'other'],
            [/instance folder/, `"${portable}"`],
            [/Nexus Mods API key/, ''],
            [/Set up Muddy/, false]
        ]);
        expect(fs.existsSync(instancesDir)).toBe(false);
        const { choices, draft } = await run(context, prompter);
        expect(notes.some(note => /ModOrganizer\.ini/.test(note))).toBe(true);
        expect(choices.instance).toBe(portable);
        expect(draft.agents).toEqual(context.config.agents);
        expect(draft.plugins.entries['skyrim-modding-tools'].config).toEqual({ mo2Instance: portable });
    });

    it('keeps an instance and a key already set without asking for them again', async () => {
        const { context } = setup();
        context.settingsEnv = { SKYRIM_MO2_INSTANCE: 'G:\\Modding\\Test', NEXUS_API_KEY: 'key' };
        const { prompter, asked } = scripted([[/Keep the Mod Organizer instance/, true], [/Set up Muddy/, false]]);
        const { choices } = await run(context, prompter);
        expect(choices).toEqual({ instance: undefined, muddy: undefined });
        expect(asked).toHaveLength(2);
    });
});

describe('an agent called Muddy already', () => {
    /** Muddy as a modder set him up by hand: sharing a workspace with an eval agent, with tools and skills of his own. */
    const handMade = (root: string): Config => ({
        agents: {
            defaults: { model: { primary: 'ollama/small:4b' } },
            entries: {
                'skyrim-e4b': { workspace: path.join(root, 'workspace-skyrim') },
                'skyrim-strata': {
                    name: 'Muddy', workspace: path.join(root, 'workspace-skyrim'),
                    identity: { name: 'Muddy', avatar: 'avatars/mudcrab.png', emoji: '🦀' },
                    model: { primary: 'strata/big', fallbacks: [] }, modelPolicy: { allow: ['strata/big'] },
                    thinkingDefault: 'high', skills: ['skyrim-modding-basics', 'graphify'],
                    tools: { allow: ['read', 'skyrim-modding-tools', 'nodes', 'skill_workshop'] }
                }
            }
        },
        models: { providers: { strata: { models: [{ id: 'big', contextWindow: 131072, contextTokens: 131072 }] } } }
    });

    it('is found by his name, and updated in place, his own tools and skills kept', async () => {
        const { root, context } = setup();
        context.config = handMade(root);
        expect(findMuddy(context.config)?.id).toBe('skyrim-strata');
        const { prompter } = scripted([
            [/Which Mod Organizer instance/, 'skip'],
            [/Nexus Mods API key/, ''],
            [/Update Muddy .*skyrim-strata/, true],
            [/Which model/, 'strata/big'],
            [/keep in mind/, 131072],
            [/How long should Muddy think/, 'medium'],
            [/learn from his work/, true]
        ]);
        const { choices, draft } = await run(context, prompter);
        const muddy = draft.agents.entries['skyrim-strata'];
        expect(choices.muddy?.contextTokens).toBeUndefined();
        expect(muddy.skills).toEqual(expect.arrayContaining(['graphify', 'skyrim-modding-npcs']));
        expect(muddy.tools.allow).toEqual(expect.arrayContaining(['nodes', 'skill_workshop', 'web_search']));
        expect(muddy.thinkingDefault).toBe('medium');
        expect(draft.agents.entries[MUDDY.id]).toBeUndefined();
        expect(draft.plugins.entries['skyrim-modding-tools'].config.agents).toEqual(['skyrim-strata']);
    });

    it('moves him out of a workspace another agent shares, so his soul does not reach that agent', async () => {
        const { root, context } = setup();
        context.config = handMade(root);
        const { prompter } = scripted([
            [/Which Mod Organizer instance/, 'skip'], [/Nexus/, ''], [/Update Muddy/, true], [/Which model/, 'strata/big'],
            [/keep in mind/, 131072], [/think/, 'high'], [/learn/, false]
        ]);
        const { draft } = await run(context, prompter);
        const muddy = draft.agents.entries['skyrim-strata'];
        expect(muddy.workspace).toBe(path.join(context.stateDir, 'workspace-muddy'));
        expect(muddy.tools.allow).not.toContain('skill_workshop');
        expect(draft.agents.entries['skyrim-e4b']).toEqual(context.config.agents.entries['skyrim-e4b']);
    });

    it('adds a new model to his own model list, which would refuse it', async () => {
        const { root, context } = setup();
        context.config = handMade(root);
        const { prompter } = scripted([
            [/Which Mod Organizer instance/, 'skip'], [/Nexus/, ''], [/Update Muddy/, true], [/Which model/, 'ollama/small:4b'],
            [/keep in mind/, 131072], [/think/, 'medium'], [/learn/, true]
        ]);
        context.config.models.providers.ollama = { models: [{ id: 'small:4b', contextTokens: 131072 }] };
        const { draft } = await run(context, prompter);
        expect(draft.agents.entries['skyrim-strata'].modelPolicy.allow).toEqual(['strata/big', 'ollama/small:4b']);
    });

    it('asks before his files replace the ones in his workspace', async () => {
        const { root, context } = setup();
        context.config = handMade(root);
        context.config.agents.entries['skyrim-e4b'].workspace = path.join(root, 'workspace-eval');
        const { prompter } = scripted([
            [/Which Mod Organizer instance/, 'skip'], [/Nexus/, ''], [/Update Muddy/, true], [/Which model/, 'strata/big'],
            [/keep in mind/, 131072], [/think/, 'medium'], [/learn/, true], [/has SOUL\.md already/, false]
        ]);
        const choices = await askSetup(prompter, context, {}, (_folder, file) => file === 'SOUL.md');
        expect(choices.muddy).toMatchObject({ workspace: path.join(root, 'workspace-skyrim'), replaceFiles: false });
    });
});

describe('taking every default (--yes)', () => {
    it('picks no instance by itself, skips the key, and sets Muddy up on the default model', async () => {
        const { instancesDir, context } = setup();
        instance(instancesDir, 'Skyrim Test');
        const { choices, draft } = await run(context, defaultsPrompter(() => { }), { yes: true });
        expect(choices.instance).toBeUndefined();
        expect(choices.nexusApiKey).toBeUndefined();
        expect(choices.muddy).toMatchObject({ agentId: MUDDY.id, model: 'ollama/small:4b', thinking: 'medium', learn: true, contextTokens: undefined });
        expect(draft.agents.entries[MUDDY.id].model.primary).toBe('ollama/small:4b');
    });

    it('takes the instance, the model and the rest from the command line', async () => {
        const { instancesDir, context } = setup();
        const test = instance(instancesDir, 'Skyrim Test');
        const flags = { yes: true, instance: test, model: 'ollama/bigger:12b', context: 65536, thinking: 'low', learn: false };
        const { choices, draft } = await run(context, defaultsPrompter(() => { }), flags);
        expect(choices.instance).toBe(test);
        expect(choices.muddy).toMatchObject({ model: 'ollama/bigger:12b', addToOllama: 'bigger:12b', contextTokens: 65536, thinking: 'low', learn: false });
        expect(draft.agents.entries[MUDDY.id].tools.allow).not.toContain('skill_workshop');
    });

    it('refuses an instance or a thinking level it cannot use, before anything is written', async () => {
        const { root, context } = setup();
        await expect(askSetup(defaultsPrompter(() => { }), context, { yes: true, instance: path.join(root, 'nothing') }, nothingThere))
            .rejects.toThrow(/ModOrganizer\.ini/);
        await expect(askSetup(defaultsPrompter(() => { }), context, { yes: true, thinking: 'max' }, nothingThere))
            .rejects.toThrow(/--thinking max/);
    });

    it('leaves Muddy out with --no-muddy', async () => {
        const { context } = setup();
        const { choices } = await run(context, defaultsPrompter(() => { }), { yes: true, muddy: false });
        expect(choices.muddy).toBeUndefined();
    });
});

describe('the summary', () => {
    it('says how to talk to Muddy, and that OpenClaw\'s self-learning is off where it is', () => {
        const choices = { muddy: { agentId: 'muddy', model: 'ollama/small:4b', thinking: 'medium', learn: true, workspace: 'W', replaceFiles: false } };
        expect(setupSummary(choices, false)).toMatch(/self-learning is off/);
        expect(setupSummary(choices, true)).not.toMatch(/self-learning/);
        expect(setupSummary(choices, true)).toContain('openclaw tui --session agent:muddy:main');
        expect(setupSummary({}, true)).toBe('Nothing changed.');
    });
});
