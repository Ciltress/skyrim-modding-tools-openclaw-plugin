import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'dotenv';
import { CORE_GUIDES, type Product } from 'skyrim-modding-tools-core';

/**
 * The plugin's folder. This file compiles to dist/settings.js and runs from src/ under vitest, both one level
 * below it.
 */
export const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const packageJson = JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, 'package.json'), 'utf8'));

/** The plugin's id, as openclaw.plugin.json and `plugins.entries.<id>` name it. */
export const PLUGIN_ID = 'skyrim-modding-tools';

/** What `plugins.entries.skyrim-modding-tools.config` may hold. */
export const CONFIG_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    properties: {
        envFile: {
            type: 'string',
            description:
                'A .env file with the settings the MCP server reads (SKYRIM_MO2_INSTANCE, NEXUS_API_KEY, ' +
                'SKYRIM_PROJECTS_DIR, MCP_PROFILE, …) — the MCP server\'s own, to share them. Its folder is where ' +
                'a relative path starts, and where projects/ is unless SKYRIM_PROJECTS_DIR says otherwise.'
        },
        env: {
            type: 'object',
            additionalProperties: { type: 'string' },
            description: 'Settings by the same names, over the envFile\'s.'
        },
        agents: {
            type: 'array',
            items: { type: 'string' },
            description:
                'The agents that mod: they get the tools\' instructions in their system prompt, and are asked to ' +
                'build a project they changed and did not build before they answer.'
        }
    }
} as const;

export interface PluginSettings {
    /** The settings, by the MCP server's variable names. */
    env: NodeJS.ProcessEnv;
    /** The product's folder: the envFile's, else the plugin's. */
    root: string;
    /** The agents that mod. Empty: no agent gets the instructions or the build check. */
    agents: readonly string[];
}

/**
 * The plugin's settings from its config. A relative envFile is the plugin's folder's. Throws on an envFile that
 * cannot be read, so a wrong path fails when the gateway loads the plugin, not on the first tool call.
 */
export function readSettings(config: Record<string, unknown> | undefined, pluginRoot = PLUGIN_ROOT): PluginSettings {
    const envFile = typeof config?.envFile === 'string' && config.envFile.trim()
        ? path.resolve(pluginRoot, config.envFile.trim())
        : undefined;
    let fromFile: Record<string, string> = {};
    if (envFile) {
        try {
            fromFile = parse(fs.readFileSync(envFile));
        } catch (error) {
            throw new Error(`The plugin's envFile ${envFile} cannot be read: ${(error as Error).message}`);
        }
    }
    const given = config?.env && typeof config.env === 'object' ? config.env as Record<string, unknown> : {};
    const env: NodeJS.ProcessEnv = { ...fromFile };
    for (const [name, value] of Object.entries(given)) if (typeof value === 'string') env[name] = value;
    const agents = Array.isArray(config?.agents) ? config.agents.filter((a): a is string => typeof a === 'string') : [];
    return { env, root: envFile ? path.dirname(envFile) : pluginRoot, agents };
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
