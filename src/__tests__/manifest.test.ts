import fs from 'node:fs';
import path from 'node:path';
import { renderManifest } from '../manifest.js';
import { PLUGIN_ROOT } from '../settings.js';

/**
 * openclaw.plugin.json, which OpenClaw reads before it loads the plugin, held to the tools the plugin registers:
 * a tool missing from contracts.tools goes missing from discovery. Regenerate with `npm run build && npm run
 * manifest`. Line ends normalised, as git checks the file out with CRLF on Windows.
 */
describe('the committed manifest', () => {
    const lf = (text: string) => text.replace(/\r\n/g, '\n');

    it('matches what the tools render', () => {
        expect(lf(fs.readFileSync(path.join(PLUGIN_ROOT, 'openclaw.plugin.json'), 'utf8'))).toBe(lf(renderManifest()));
    });

    it('names every tool as optional, and ships the skills folder the build fills', () => {
        const manifest = JSON.parse(renderManifest());
        expect(Object.keys(manifest.toolMetadata)).toEqual(manifest.contracts.tools);
        expect(Object.values(manifest.toolMetadata).every((m: any) => m.optional === true)).toBe(true);
        expect(manifest.skills).toEqual(['skills/Domain/skills']);
    });
});
