import type { AppBackend } from 'skyrim-modding-tools-core';
import { CONFIG_CONTRACTS, CONFIG_GROUPS, CONFIG_SCHEMA, PLUGIN_ID, PLUGIN_ROOT, UI_HINTS, pluginProduct } from './settings.js';
import { SkyrimTools } from './tools.js';

/**
 * openclaw.plugin.json, rendered from the tools themselves: every tool the plugin can register, each optional,
 * the config it reads with how OpenClaw's Settings page shows it, and the core's skills (copied into skills/ by the
 * build). Rendered with every profile's tools, since the profile is the user's setting; getTools() never touches
 * the backend.
 */
export function renderManifest(): string {
    const names = new SkyrimTools(undefined as unknown as AppBackend, pluginProduct(PLUGIN_ROOT), {}).toolNames();
    const manifest = {
        id: PLUGIN_ID,
        name: 'Skyrim Modding Tools',
        description:
            'Skyrim SE modding: records across a mod manager\'s load order, mods and patches authored as text and ' +
            'built into plugins, mods installed — the tools of skyrim-modding-tools-core under their own names.',
        categories: ['developer-tools'],
        activation: { onStartup: true },
        configSchema: CONFIG_SCHEMA,
        uiHints: UI_HINTS,
        configGroups: CONFIG_GROUPS,
        configContracts: CONFIG_CONTRACTS,
        // The folder whose children are the skills: OpenClaw links each child holding a SKILL.md into its
        // plugin-skills, and does not search deeper (skills/Domain alone gave it nothing to link).
        skills: ['skills/Domain/skills'],
        contracts: { tools: names },
        toolMetadata: Object.fromEntries(names.map(name => [name, { optional: true }]))
    };
    return `${JSON.stringify(manifest, null, 2)}\n`;
}
