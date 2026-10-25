import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CORE_GUIDES, type Product } from 'skyrim-modding-tools-core';

/**
 * The plugin's folder. This file compiles to dist/settings.js and runs from src/ under vitest, both one level
 * below it. In the gateway it is OpenClaw's copy of the plugin, replaced on every reload: where the plugin is
 * installed, OpenClaw says as `api.rootDir`.
 */
export const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const packageJson = JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, 'package.json'), 'utf8'));

/** The plugin's id, as openclaw.plugin.json and `plugins.entries.<id>` name it. */
export const PLUGIN_ID = 'skyrim-modding-tools';

/** One field of the plugin's config: the core's setting it gives, and how OpenClaw's Settings page shows it. */
interface Setting {
    /** The setting's name where the core reads it, the MCP server's variable. */
    variable: string;
    schema: { type: 'string' | 'integer' | 'boolean'; enum?: readonly string[]; minimum?: number };
    label: string;
    help: string;
    placeholder?: string;
    advanced?: true;
    sensitive?: true;
    /** The value the core reads: a boolean field says only when it is off. */
    value?: (given: unknown) => string | undefined;
}

/**
 * Every setting of the core's a plugin user may set, in the order Settings shows them. A path may start with `~`
 * and use `$NAME`; a relative one is the plugin's folder's (the core's pathSettings.ts).
 */
export const SETTINGS = {
    modManager: {
        variable: 'SKYRIM_MOD_MANAGER',
        schema: { type: 'string', enum: ['mo2', 'amethyst'] },
        label: 'Mod manager',
        help: 'mo2 (Mod Organizer 2) or amethyst (Amethyst, Linux). Unset: Mod Organizer when an instance is set, ' +
            'else Amethyst when it has Skyrim Special Edition set up.'
    },
    mo2Instance: {
        variable: 'SKYRIM_MO2_INSTANCE',
        schema: { type: 'string' },
        label: 'Mod Organizer instance',
        help: 'The instance folder, the one with ModOrganizer.ini in it; the tools follow its selected profile. ' +
            'Use a test instance: deploys write into its mods and profile.',
        placeholder: 'G:\\Modding\\SkyrimSE-Test'
    },
    amethystDir: {
        variable: 'SKYRIM_AMETHYST_DIR',
        schema: { type: 'string' },
        label: 'Amethyst config folder',
        help: 'Only if it is neither the Flatpak\'s nor ~/.config\'s: the tools find those.',
        advanced: true
    },
    winePrefix: {
        variable: 'SKYRIM_WINE_PREFIX',
        schema: { type: 'string' },
        label: 'Wine prefix',
        help: 'Mod Organizer under Proton: the prefix it runs in, the folder with dosdevices in it. Found by itself for MO2-LINT.',
        advanced: true
    },
    projectsDir: {
        variable: 'SKYRIM_PROJECTS_DIR',
        schema: { type: 'string' },
        label: 'Projects folder',
        help: 'Where the mod projects live. Unset: projects in the plugin\'s folder. Make it the modding agents\' working folder too.'
    },
    creationKitDir: {
        variable: 'SKYRIM_CK_DIR',
        schema: { type: 'string' },
        label: 'Creation Kit folder',
        help: 'For its Papyrus compiler and the vanilla script sources. Unset: the instance\'s game folder.',
        advanced: true
    },
    papyrusCompiler: {
        variable: 'SKYRIM_PAPYRUS_COMPILER',
        schema: { type: 'string' },
        label: 'Papyrus compiler',
        help: 'PapyrusCompiler.exe, or russo-2025\'s papyrus-compiler on Linux. Unset: the Creation Kit\'s on Windows; on ' +
            'Linux papyrus-compiler on PATH.',
        advanced: true
    },
    nexusApiKey: {
        variable: 'NEXUS_API_KEY',
        schema: { type: 'string' },
        label: 'Nexus Mods API key',
        help: 'Your personal key, from your Nexus Mods account settings. Without it the Nexus tools are not offered; ' +
            'downloadNexusFile only for a premium account.',
        sensitive: true
    },
    profile: {
        variable: 'MCP_PROFILE',
        schema: { type: 'string', enum: ['core', 'readonly', 'all'] },
        label: 'Tool profile',
        help: 'Which tools are offered: all (the default), core, or readonly.',
        advanced: true
    },
    maxResponseBytes: {
        variable: 'MCP_MAX_RESPONSE_BYTES',
        schema: { type: 'integer', minimum: 0 },
        label: 'Answer size limit (bytes)',
        help: 'The ceiling on one answer; 0 removes it. Unset: the profile\'s.',
        advanced: true,
        value: given => typeof given === 'number' ? String(given) : undefined
    },
    capabilityGate: {
        variable: 'MCP_GATE',
        schema: { type: 'boolean' },
        label: 'Withhold what the backend cannot serve',
        help: 'On (the default): a tool the backend cannot serve — the Nexus tools without a key — is not offered.',
        advanced: true,
        value: given => given === false ? 'off' : undefined
    },
    helperPath: {
        variable: 'SKYRIM_HELPER_PATH',
        schema: { type: 'string' },
        label: 'Plugin helper',
        help: 'A built SkyrimHelper. Unset: the one npm run build:helper builds.',
        advanced: true
    }
} as const satisfies Record<string, Setting>;

type Field = keyof typeof SETTINGS;

const AGENTS_HELP =
    'The agents that mod: they get the tools\' instructions in their system prompt, and are asked to build a project ' +
    'they changed and did not build before they answer.';

/** Each setting mapped to what one part of the manifest says of it, by its field. */
function bySetting<T>(map: (setting: Setting) => T): Record<Field, T> {
    return Object.fromEntries(Object.entries(SETTINGS).map(([field, setting]) => [field, map(setting)])) as unknown as Record<Field, T>;
}

/** What `plugins.entries.skyrim-modding-tools.config` may hold. */
export const CONFIG_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    properties: {
        ...bySetting<Record<string, unknown>>(setting => ({ ...setting.schema, description: setting.help })),
        agents: { type: 'array', items: { type: 'string' }, description: AGENTS_HELP }
    }
} as const;

interface UiHint { label: string; help: string; placeholder?: string; advanced?: boolean; sensitive?: boolean }

/** Labels, help and placeholders for OpenClaw's Settings page; the Nexus key is shown hidden. */
export const UI_HINTS: Record<Field | 'agents', UiHint> = {
    ...bySetting<UiHint>(setting => ({
        label: setting.label,
        help: setting.help,
        ...(setting.placeholder ? { placeholder: setting.placeholder } : {}),
        ...(setting.advanced ? { advanced: true } : {}),
        ...(setting.sensitive ? { sensitive: true } : {})
    })),
    agents: { label: 'Modding agents', help: AGENTS_HELP, placeholder: 'skyrim-e4b' }
};

/** The Settings page's sections. */
export const CONFIG_GROUPS = [
    { id: 'game', title: 'Mod manager', order: 10, properties: ['modManager', 'mo2Instance', 'amethystDir', 'winePrefix'] },
    { id: 'projects', title: 'Projects and scripts', order: 20, properties: ['projectsDir', 'creationKitDir', 'papyrusCompiler'] },
    { id: 'agents', title: 'Agents', order: 30, properties: ['agents'] },
    { id: 'nexus', title: 'Nexus Mods', order: 40, properties: ['nexusApiKey'] },
    { id: 'tools', title: 'Tools', order: 50, properties: ['profile', 'maxResponseBytes', 'capabilityGate', 'helperPath'] }
] as const;

/** The Nexus key is a secret: concealed in Settings, and it may be a SecretRef, resolved before the plugin reads it. */
export const CONFIG_CONTRACTS = {
    secretInputs: { paths: [{ path: 'nexusApiKey', expected: 'string' }] }
} as const;

export interface PluginSettings {
    /** The settings, by the core's names. */
    env: NodeJS.ProcessEnv;
    /** Where a relative path starts and projects/ is by default: the plugin's folder. */
    root: string;
    /** The agents that mod. Empty: no agent gets the instructions or the build check. */
    agents: readonly string[];
}

/**
 * The plugin's settings from its config, which OpenClaw has checked against CONFIG_SCHEMA. A blank field is unset,
 * left to the core to find or default. `root` is the plugin's folder.
 */
export function readSettings(config: Record<string, unknown> | undefined, root: string): PluginSettings {
    const env: NodeJS.ProcessEnv = {};
    for (const [field, setting] of Object.entries(SETTINGS) as [Field, Setting][]) {
        const given = config?.[field];
        const value = setting.value ? setting.value(given) : typeof given === 'string' && given.trim() ? given.trim() : undefined;
        if (value !== undefined) env[setting.variable] = value;
    }
    const agents = Array.isArray(config?.agents) ? config.agents.filter((a): a is string => typeof a === 'string') : [];
    return { env, root, agents };
}

/** The plugin as the core serves it: its name and version, the settings' root, and the core's two guides. */
export function pluginProduct(root: string): Product {
    return {
        name: String(packageJson.name),
        version: String(packageJson.version),
        root,
        guides: [CORE_GUIDES.router, CORE_GUIDES.tools]
    };
}
