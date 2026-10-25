import path from 'node:path';
import { PATH_SETTINGS } from 'skyrim-modding-tools-core';
import { CONFIG_CONTRACTS, CONFIG_GROUPS, CONFIG_SCHEMA, SETTINGS, UI_HINTS, pluginProduct, readSettings } from '../settings.js';

/**
 * The plugin's config: each of the core's settings as a field of OpenClaw's own config, which its Settings page
 * shows and edits (the user's call, 2026-10-25: no .env of the MCP server's), and the agents that mod.
 */

const root = path.resolve('/plugins/skyrim-modding-tools');

describe('readSettings', () => {
    it('gives the core each field as its setting, and the agents that mod', () => {
        const settings = readSettings({
            modManager: 'mo2', mo2Instance: 'G:\\Modding\\Test', nexusApiKey: 'key', projectsDir: 'D:\\Mods\\projects',
            profile: 'core', maxResponseBytes: 0, capabilityGate: false, agents: ['skyrim-e4b', 3]
        }, root);
        expect(settings).toEqual({
            env: {
                SKYRIM_MOD_MANAGER: 'mo2', SKYRIM_MO2_INSTANCE: 'G:\\Modding\\Test', NEXUS_API_KEY: 'key',
                SKYRIM_PROJECTS_DIR: 'D:\\Mods\\projects', MCP_PROFILE: 'core', MCP_MAX_RESPONSE_BYTES: '0', MCP_GATE: 'off'
            },
            root,
            agents: ['skyrim-e4b']
        });
    });

    it('leaves a field unset or blank to the core, which finds or defaults it', () => {
        expect(readSettings({ mo2Instance: '  ', capabilityGate: true }, root)).toEqual({ env: {}, root, agents: [] });
        expect(readSettings(undefined, root)).toEqual({ env: {}, root, agents: [] });
    });
});

describe('the config OpenClaw shows', () => {
    const fields = Object.keys(CONFIG_SCHEMA.properties);

    it('has a field for every path setting the core reads', () => {
        const variables = Object.values(SETTINGS).map(setting => setting.variable);
        for (const name of PATH_SETTINGS) expect(variables, name).toContain(name);
    });

    it('labels every field, and keeps the Nexus key hidden and open to a SecretRef', () => {
        for (const field of fields) expect(UI_HINTS[field as keyof typeof UI_HINTS]?.label, field).toBeTruthy();
        expect(UI_HINTS.nexusApiKey.sensitive).toBe(true);
        expect(CONFIG_CONTRACTS.secretInputs.paths).toEqual([{ path: 'nexusApiKey', expected: 'string' }]);
    });

    it('puts every field into one Settings section', () => {
        expect(CONFIG_GROUPS.flatMap(group => group.properties).sort()).toEqual([...fields].sort());
    });
});

describe('pluginProduct', () => {
    it('serves the core\'s two guides under the plugin\'s name', () => {
        const product = pluginProduct('/root');
        expect(product.name).toBe('skyrim-modding-tools-openclaw-plugin');
        expect(product.guides.map(guide => guide.id)).toEqual(['router', 'tools']);
        expect(product.root).toBe('/root');
    });
});
