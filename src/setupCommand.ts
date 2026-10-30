import fs from 'node:fs';
import path from 'node:path';
import type { OpenClawPluginApi } from 'openclaw/plugin-sdk/plugin-entry';
import { createClackPrompter } from 'openclaw/plugin-sdk/setup-runtime';
import { resolveStateDir } from 'openclaw/plugin-sdk/state-paths';
import { readConfiguration, writeMuddyWorkspace } from 'skyrim-modding-tools-core';
import { PLUGIN_ID, PLUGIN_ROOT, readSettings } from './settings.js';
import { applySetup, askSetup, defaultsPrompter, setupSummary, type Config, type SetupFlags } from './setup.js';

/** The root command the plugin owns, as the manifest declares it for OpenClaw's help. */
export const CLI_COMMAND = {
    name: 'skyrim',
    description: 'Skyrim Modding Tools: set them up, and Muddy, the modding agent',
    hasSubcommands: true
} as const;

/** The models Ollama has installed, asked at its own address; none when it does not answer in time. */
async function ollamaModels(config: Config): Promise<string[]> {
    const base = String(config.models?.providers?.ollama?.baseUrl ?? 'http://127.0.0.1:11434').replace(/\/v1\/?$/, '').replace(/\/$/, '');
    try {
        const response = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(3000) });
        const body = await response.json() as { models?: { name?: string }[] };
        return (body.models ?? []).map(model => model.name).filter((name): name is string => typeof name === 'string');
    } catch {
        return [];
    }
}

/** `openclaw skyrim setup`: asks, then writes Muddy's workspace files and the config in one go. */
async function runSetup(api: OpenClawPluginApi, config: Config, flags: SetupFlags): Promise<void> {
    const prompter = flags.yes ? defaultsPrompter() : createClackPrompter();
    const settings = readSettings(config.plugins?.entries?.[PLUGIN_ID]?.config, api.rootDir ?? PLUGIN_ROOT, resolveStateDir(process.env));
    const context = {
        config,
        settingsEnv: settings.env,
        env: process.env,
        root: settings.root,
        stateDir: resolveStateDir(process.env),
        projectsDir: readConfiguration(settings.env, { root: settings.root }).paths.SKYRIM_PROJECTS_DIR!,
        platform: process.platform,
        ollamaModels: () => ollamaModels(config)
    };
    const choices = await askSetup(prompter, context, flags, (folder, file) => fs.existsSync(path.join(folder, file)));
    if (!choices.instance && !choices.nexusApiKey && !choices.muddy) {
        await prompter.outro('Nothing changed.');
        return;
    }
    if (choices.muddy) writeMuddyWorkspace(choices.muddy.workspace, { overwrite: choices.muddy.replaceFiles });
    await api.runtime.config.mutateConfigFile({
        afterWrite: { mode: 'auto' },
        mutate: draft => applySetup(draft as Config, choices, context)
    });
    await prompter.outro(setupSummary(choices, config.skills?.workshop?.autonomous?.mode === 'auto'));
}

/** The command, registered where OpenClaw's CLI asks for it; its help comes from CLI_COMMAND without loading this. */
export function registerSetupCommand(api: OpenClawPluginApi): void {
    api.registerCli(({ program, config }) => {
        const skyrim = program.command(CLI_COMMAND.name).description(CLI_COMMAND.description);
        skyrim.command('setup')
            .description('Set the tools up — the Mod Organizer instance, the Nexus key — and Muddy 🦀, the modding agent')
            .option('--yes', 'take every default and ask nothing (an instance is set only with --instance)')
            .option('--instance <folder>', 'the Mod Organizer instance, the folder with ModOrganizer.ini in it')
            .option('--no-muddy', 'leave Muddy out')
            .option('--model <ref>', 'Muddy\'s model, as provider/model')
            .option('--context <tokens>', 'his model\'s context, in tokens', value => Number.parseInt(value, 10))
            .option('--thinking <level>', 'off, low, medium or high')
            .option('--no-learn', 'no skill_workshop: he does not write skills of his own')
            .action(async (options: Record<string, unknown>, command: { getOptionValueSource(name: string): string | undefined }) => {
                // A --no-… option is true by default: only given, it answers the question.
                const given = (name: string) => command.getOptionValueSource(name) === 'cli';
                await runSetup(api, config as Config, {
                    yes: options.yes === true,
                    instance: options.instance as string | undefined,
                    muddy: given('muddy') ? options.muddy as boolean : undefined,
                    model: options.model as string | undefined,
                    context: options.context as number | undefined,
                    thinking: options.thinking as string | undefined,
                    learn: given('learn') ? options.learn as boolean : undefined
                });
            });
    }, { descriptors: [CLI_COMMAND] });
}
