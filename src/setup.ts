import path from 'node:path';
import type { WizardPrompter, WizardSelectParams } from 'openclaw/plugin-sdk/setup';
import {
    checkMo2Instance, chooseModManager, discoverSkills, MUDDY, MUDDY_WORKSPACE_FILES, mo2InstancesDir, skyrimInstances
} from 'skyrim-modding-tools-core';
import { PLUGIN_ID } from './settings.js';

/**
 * `openclaw skyrim setup`: the plugin's settings a modder cannot leave to the tools to find, and Muddy, the modding
 * agent, with his model, context, thinking level, tools and skills. OpenClaw's own wizard prompts ask, so it looks
 * like OpenClaw's setup of a channel; `--yes` takes every default and asks nothing, for an agent running it.
 */

/** OpenClaw's config, as far as setup reads and writes it: plain JSON. */
export type Config = Record<string, any>;

/** What setup needs besides the prompts: the config as it is, and where things go. */
export interface SetupContext {
    /** OpenClaw's config, read-only. */
    config: Config;
    /** The plugin's settings as the core reads them (SKYRIM_*), for what the tools find without a setting. */
    settingsEnv: NodeJS.ProcessEnv;
    /** The environment, for the folders a setting may name. */
    env: NodeJS.ProcessEnv;
    /** Where a relative setting starts: the plugin's folder. */
    root: string;
    /** OpenClaw's state folder, where a new agent's workspace goes. */
    stateDir: string;
    /** The projects folder: Muddy's working folder. */
    projectsDir: string;
    platform: NodeJS.Platform;
    /** The models Ollama has installed, by name; none when it does not answer. */
    ollamaModels(): Promise<string[]>;
}

/** What may be given on the command line instead of asked. */
export interface SetupFlags {
    yes?: boolean;
    instance?: string;
    muddy?: boolean;
    model?: string;
    context?: number;
    thinking?: string;
    learn?: boolean;
}

export interface MuddyChoices {
    agentId: string;
    model: string;
    /** A model Ollama has that OpenClaw's config does not list yet: listed under the ollama provider. */
    addToOllama?: string;
    contextTokens?: number;
    thinking: string;
    learn: boolean;
    workspace: string;
    /** His files replace the ones in the workspace; otherwise the ones there are kept. */
    replaceFiles: boolean;
}

export interface SetupChoices {
    instance?: string;
    nexusApiKey?: string;
    muddy?: MuddyChoices;
}

export const THINKING_LEVELS = ['off', 'low', 'medium', 'high'] as const;
const CONTEXT_SIZES = [32768, 65536, 131072, 262144];

/**
 * Muddy's tools: the plugin's, the file tools for his project files, the web for what the tools do not cover, his
 * memory, and skill_workshop when he may learn skills from his work.
 */
export function muddyTools(learn: boolean): string[] {
    return ['read', 'write', 'edit', 'apply_patch', 'ls', 'skills_read', PLUGIN_ID, 'web_search', 'web_fetch',
        'memory_get', 'memory_search', ...(learn ? ['skill_workshop'] : [])];
}

const kTokens = (tokens: number) => `${Math.round(tokens / 1024)}k`;
const samePath = (a: string, b: string, platform: NodeJS.Platform) =>
    platform === 'win32' ? path.win32.resolve(a).toLowerCase() === path.win32.resolve(b).toLowerCase() : path.resolve(a) === path.resolve(b);

/** The agents, by id. */
function agentEntries(config: Config): Record<string, Config> {
    return (config.agents?.entries ?? {}) as Record<string, Config>;
}

/** An agent called Muddy: the id `muddy`, or one named so. */
export function findMuddy(config: Config): { id: string; entry: Config } | undefined {
    const entries = Object.entries(agentEntries(config));
    const named = ([id, entry]: [string, Config]) =>
        id === MUDDY.id || [entry.name, entry.identity?.name].some(name => typeof name === 'string' && name.trim().toLowerCase() === 'muddy');
    const found = entries.find(([id]) => id === MUDDY.id) ?? entries.find(named);
    return found && { id: found[0], entry: found[1] };
}

/** A model reference's provider and model id: `ollama/name:tag` is provider `ollama`, model `name:tag`. */
export function splitModelRef(ref: string): { provider: string; id: string } {
    const slash = ref.indexOf('/');
    return slash < 0 ? { provider: '', id: ref } : { provider: ref.slice(0, slash), id: ref.slice(slash + 1) };
}

/** The models OpenClaw's config lists, as `provider/model`, with their context. */
function configuredModels(config: Config): { ref: string; context?: number }[] {
    return Object.entries((config.models?.providers ?? {}) as Record<string, Config>).flatMap(([provider, settings]) =>
        ((settings.models ?? []) as Config[]).filter(model => typeof model.id === 'string').map(model => ({
            ref: `${provider}/${model.id}`,
            context: model.contextTokens ?? model.contextWindow
        })));
}

/** The model entry a reference names in the config, if it lists one. */
function modelEntry(config: Config, ref: string): Config | undefined {
    const { provider, id } = splitModelRef(ref);
    return ((config.models?.providers?.[provider]?.models ?? []) as Config[]).find(model => model.id === id);
}

/** Every prompt's answer taken as offered: the initial value, else the first choice; nothing typed, no yes. */
export function defaultsPrompter(say: (text: string) => void = console.log): WizardPrompter {
    return {
        intro: async title => say(title),
        outro: async message => say(message),
        note: async (message, title) => say(title ? `${title}: ${message}` : message),
        select: async params => params.initialValue ?? params.options[0]!.value,
        multiselect: async params => params.initialValues ?? [],
        text: async params => params.initialValue ?? '',
        confirm: async params => params.initialValue ?? false,
        progress: () => ({ update: () => { }, stop: () => { } })
    };
}

/** The Mod Organizer instance, where the tools cannot find one by themselves: one found, or a folder pasted. */
async function askInstance(prompter: WizardPrompter, context: SetupContext, flags: SetupFlags): Promise<string | undefined> {
    const check = (typed: string) => checkMo2Instance(typed, context.env, { root: context.root });
    if (flags.instance) {
        const checked = check(flags.instance);
        if ('error' in checked) throw new Error(checked.error);
        return checked.instance;
    }
    const current = context.settingsEnv.SKYRIM_MO2_INSTANCE;
    if (current && await prompter.confirm({ message: `Keep the Mod Organizer instance ${current}?`, initialValue: true })) return undefined;
    if (!current && chooseModManager(context.settingsEnv).name === 'amethyst') {
        await prompter.note('Amethyst has Skyrim Special Edition set up: the tools use it.', 'Mod manager');
        return undefined;
    }

    await prompter.note('Use a test instance: deploying and installing write into its mods and its profile.', 'Mod Organizer');
    const instancesDir = mo2InstancesDir(context.env, context.platform);
    const found = instancesDir ? skyrimInstances(instancesDir) : [];
    for (; ;) {
        const options: WizardSelectParams<string>['options'] = [
            ...found.map(dir => ({ value: dir, label: dir })),
            { value: 'other', label: 'Another folder', hint: 'a portable instance: the folder with ModOrganizer.ini in it' },
            { value: 'skip', label: 'Not now', hint: 'the tools then have no game to work on' }
        ];
        const picked = await prompter.select({
            message: 'Which Mod Organizer instance should the tools work on?',
            options,
            // Taken without asking, no instance is picked: which one is the test instance, only the user knows.
            initialValue: flags.yes ? 'skip' : found.length === 1 ? found[0] : found.length === 0 ? 'other' : undefined
        });
        if (picked === 'skip') return undefined;
        const typed = picked === 'other'
            ? await prompter.text({
                message: 'The instance folder (the one with ModOrganizer.ini in it)',
                validate: value => { const checked = check(value); return 'error' in checked ? checked.error : undefined; }
            })
            : picked;
        if (!typed) return undefined;
        const checked = check(typed);
        if ('instance' in checked) return checked.instance;
        await prompter.note(checked.error, 'Mod Organizer');
    }
}

/** The model Muddy thinks with: one OpenClaw lists, one Ollama has, or one typed. */
async function askModel(prompter: WizardPrompter, context: SetupContext, flags: SetupFlags, current?: string): Promise<{ model: string; addToOllama?: string }> {
    const listed = configuredModels(context.config);
    const ollama = context.config.models?.providers?.ollama
        ? (await context.ollamaModels()).filter(name => !listed.some(model => model.ref === `ollama/${name}`))
        : [];
    if (flags.model) {
        const { provider, id } = splitModelRef(flags.model);
        return provider === 'ollama' && ollama.includes(id) ? { model: flags.model, addToOllama: id } : { model: flags.model };
    }
    const fallback = context.config.agents?.defaults?.model?.primary as string | undefined;
    const picked = await prompter.select<string>({
        message: 'Which model should Muddy think with?',
        options: [
            ...listed.map(model => ({
                value: model.ref, label: model.ref,
                hint: [model.ref === current ? 'his model now' : model.ref === fallback ? 'your default model' : '', model.context ? `${kTokens(model.context)} context` : '']
                    .filter(Boolean).join(', ') || undefined
            })),
            ...ollama.map(name => ({ value: `ollama/${name}`, label: `ollama/${name}`, hint: 'installed in Ollama, added to OpenClaw' })),
            { value: 'other', label: 'Another model', hint: 'provider/model, as OpenClaw names it' }
        ],
        initialValue: current ?? fallback,
        searchable: true
    });
    if (picked !== 'other') {
        const id = splitModelRef(picked).id;
        return picked.startsWith('ollama/') && ollama.includes(id) ? { model: picked, addToOllama: id } : { model: picked };
    }
    const typed = await prompter.text({
        message: 'The model, as provider/model',
        placeholder: 'ollama/name:tag',
        validate: value => /^[^/\s]+\/\S+$/.test(value.trim()) ? undefined : 'Write it as provider/model.'
    });
    // Taken without asking, where OpenClaw lists no model and has no default one.
    if (!typed.trim()) throw new Error('No model for Muddy: name one with --model provider/model.');
    return { model: typed.trim() };
}

/** How much Muddy keeps in mind at once: the model's context, which OpenClaw sets per model. */
async function askContext(prompter: WizardPrompter, flags: SetupFlags, current: number | undefined): Promise<number | undefined> {
    if (flags.context) return flags.context;
    const sizes = [...new Set([...CONTEXT_SIZES, ...(current ? [current] : [])])].sort((a, b) => a - b);
    const picked = await prompter.select<number>({
        message: 'How much should Muddy keep in mind at once (the model\'s context)?',
        options: sizes.map(size => ({
            value: size, label: kTokens(size),
            hint: size === current ? 'as it is now' : size === 32768 ? 'enough for one mod at a time' : size >= 131072 ? 'long sessions; needs the most memory' : undefined
        })),
        initialValue: current ?? 65536
    });
    return picked === current ? undefined : picked;
}

/** The workspace Muddy gets: his own, unless he has one no other agent shares. */
function muddyWorkspace(context: SetupContext, existing?: { id: string; entry: Config }): string {
    const own = existing?.entry.workspace as string | undefined;
    const shared = own && Object.entries(agentEntries(context.config))
        .some(([id, entry]) => id !== existing!.id && typeof entry.workspace === 'string' && samePath(entry.workspace, own, context.platform));
    return own && !shared ? own : path.join(context.stateDir, 'workspace-muddy');
}

/** Muddy: whether he is wanted, and how he is set up. */
async function askMuddy(prompter: WizardPrompter, context: SetupContext, flags: SetupFlags, workspaceHas: (folder: string, file: string) => boolean): Promise<MuddyChoices | undefined> {
    const existing = findMuddy(context.config);
    const wanted = flags.muddy ?? await prompter.confirm({
        message: existing
            ? `Update Muddy 🦀 (agent ${existing.id}): his model, tools and skills?`
            : 'Set up Muddy 🦀, the mudcrab who mods Skyrim, as an agent?',
        initialValue: true
    });
    if (!wanted) return undefined;
    if (flags.thinking && !(THINKING_LEVELS as readonly string[]).includes(flags.thinking)) {
        throw new Error(`--thinking ${flags.thinking}: use ${THINKING_LEVELS.join(', ')}.`);
    }

    const { model, addToOllama } = await askModel(prompter, context, flags, existing?.entry.model?.primary);
    const listed = modelEntry(context.config, model);
    const contextTokens = listed || addToOllama
        ? await askContext(prompter, flags, listed?.contextTokens ?? listed?.contextWindow)
        : undefined;
    const thinking = flags.thinking ?? await prompter.select<string>({
        message: 'How long should Muddy think before he acts?',
        options: THINKING_LEVELS.map(level => ({ value: level, label: level, hint: level === 'medium' ? 'what the evals run with' : undefined })),
        initialValue: existing?.entry.thinkingDefault ?? 'medium'
    });
    const learn = flags.learn ?? await prompter.confirm({
        message: 'Let Muddy learn from his work? He writes down what worked as skills of his own (skill_workshop).',
        initialValue: existing ? ((existing.entry.tools?.allow ?? []) as string[]).includes('skill_workshop') : true
    });
    const workspace = muddyWorkspace(context, existing);
    const present = MUDDY_WORKSPACE_FILES.filter(file => workspaceHas(workspace, file));
    const replaceFiles = present.length > 0 && await prompter.confirm({
        message: `${workspace} has ${present.join(', ')} already. Replace them with Muddy's?`,
        initialValue: false
    });
    return { agentId: existing?.id ?? MUDDY.id, model, addToOllama, contextTokens, thinking, learn, workspace, replaceFiles };
}

/** Every question, in order. Nothing is written yet: applySetup writes the answers. */
export async function askSetup(prompter: WizardPrompter, context: SetupContext, flags: SetupFlags,
    workspaceHas: (folder: string, file: string) => boolean): Promise<SetupChoices> {
    await prompter.intro('Skyrim Modding Tools 🦀');
    const choices: SetupChoices = {};
    choices.instance = await askInstance(prompter, context, flags);
    if (!context.settingsEnv.NEXUS_API_KEY) {
        const key = await prompter.text({
            message: 'Your Nexus Mods API key, to download through Nexus with a premium account (Enter skips)',
            placeholder: 'https://www.nexusmods.com/settings/api-keys',
            sensitive: true
        });
        if (key.trim()) choices.nexusApiKey = key.trim();
    }
    choices.muddy = await askMuddy(prompter, context, flags, workspaceHas);
    return choices;
}

const union = (...lists: readonly string[][]) => [...new Set(lists.flat())];

/** The answers written into a draft of OpenClaw's config: the plugin's settings, and Muddy's agent and model. */
export function applySetup(draft: Config, choices: SetupChoices, context: Pick<SetupContext, 'projectsDir'>): void {
    const plugin = (((draft.plugins ??= {}).entries ??= {})[PLUGIN_ID] ??= {});
    const settings = (plugin.config ??= {});
    if (choices.instance) settings.mo2Instance = choices.instance;
    if (choices.nexusApiKey) settings.nexusApiKey = choices.nexusApiKey;
    const muddy = choices.muddy;
    if (!muddy) return;

    settings.agents = union(Array.isArray(settings.agents) ? settings.agents : [], [muddy.agentId]);
    // The instructions, the build check and the guards are conversation hooks, which OpenClaw runs only with this.
    plugin.hooks = { ...plugin.hooks, allowConversationAccess: true };
    const { provider, id } = splitModelRef(muddy.model);
    if (muddy.addToOllama) {
        const models = ((draft.models ??= {}).providers.ollama.models ??= []) as Config[];
        if (!models.some(model => model.id === muddy.addToOllama)) models.push({ id: muddy.addToOllama, name: muddy.addToOllama });
    }
    if (muddy.contextTokens) {
        const entry = ((draft.models?.providers?.[provider]?.models ?? []) as Config[]).find(model => model.id === id);
        if (entry) {
            entry.contextTokens = muddy.contextTokens;
            if (typeof entry.contextWindow === 'number' && entry.contextWindow < muddy.contextTokens) entry.contextWindow = muddy.contextTokens;
        }
    }

    const entries = ((draft.agents ??= {}).entries ??= {}) as Record<string, Config>;
    const before = entries[muddy.agentId] ?? {};
    const allowed = ((before.tools?.allow ?? []) as string[]).filter(tool => muddy.learn || tool !== 'skill_workshop');
    const entry: Config = {
        ...before,
        name: MUDDY.name,
        identity: { ...before.identity, name: MUDDY.name, emoji: MUDDY.emoji, avatar: MUDDY.avatar },
        workspace: muddy.workspace,
        cwd: context.projectsDir,
        model: { ...before.model, primary: muddy.model, fallbacks: before.model?.fallbacks ?? [] },
        thinkingDefault: muddy.thinking,
        skills: union(before.skills ?? [], discoverSkills().map(skill => skill.name)),
        tools: { ...before.tools, allow: union(allowed, muddyTools(muddy.learn)) }
    };
    // A model list of his own that leaves the new model out would refuse it.
    if (Array.isArray(before.modelPolicy?.allow) && !before.modelPolicy.allow.includes(muddy.model)) {
        entry.modelPolicy = { ...before.modelPolicy, allow: [...before.modelPolicy.allow, muddy.model] };
    }
    entries[muddy.agentId] = entry;
}

/** What the wizard says at its end: what it set, and how to talk to Muddy. */
export function setupSummary(choices: SetupChoices, learning: boolean): string {
    const lines: string[] = [];
    if (choices.instance) lines.push(`Mod Organizer instance: ${choices.instance}`);
    if (choices.nexusApiKey) lines.push('Nexus Mods API key: saved');
    const muddy = choices.muddy;
    if (muddy) {
        lines.push(`Muddy 🦀 is agent ${muddy.agentId}: ${muddy.model}` +
            `${muddy.contextTokens ? `, ${kTokens(muddy.contextTokens)} context` : ''}, thinking ${muddy.thinking}, workspace ${muddy.workspace}`);
        if (muddy.learn && !learning) {
            lines.push('He may learn skills, but OpenClaw\'s self-learning is off: openclaw config set skills.workshop.autonomous.mode auto');
        }
        lines.push(`Talk to him in the Control UI, or: openclaw tui --session agent:${muddy.agentId}:main`);
    }
    return lines.length ? lines.join('\n') : 'Nothing changed.';
}
