import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pluginProduct, readSettings } from '../settings.js';

/** The plugin's config: the MCP server's settings shared through its .env, and the agents that mod. */

describe('readSettings', () => {
    let dir: string;
    beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-settings-')); });
    afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

    it('reads the envFile, lets env win over it, and takes the envFile\'s folder as the root', () => {
        fs.writeFileSync(path.join(dir, '.env'), 'SKYRIM_MO2_INSTANCE=G:\\Modding\\Test\nNEXUS_API_KEY=from-file\n');
        const settings = readSettings({ envFile: path.join(dir, '.env'), env: { NEXUS_API_KEY: 'from-config' }, agents: ['skyrim-e4b', 3] });
        expect(settings.env).toEqual({ SKYRIM_MO2_INSTANCE: 'G:\\Modding\\Test', NEXUS_API_KEY: 'from-config' });
        expect(settings.root).toBe(dir);
        expect(settings.agents).toEqual(['skyrim-e4b']);
    });

    it('without an envFile, the plugin\'s folder is the root and no agent mods', () => {
        expect(readSettings(undefined, dir)).toEqual({ env: {}, root: dir, agents: [] });
    });

    it('refuses an envFile it cannot read, naming it', () => {
        expect(() => readSettings({ envFile: path.join(dir, 'missing.env') })).toThrow(/missing\.env cannot be read/);
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
