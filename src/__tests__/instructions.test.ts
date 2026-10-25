import fs from 'node:fs';
import path from 'node:path';
import { serverInstructions } from 'skyrim-modding-tools-core';
import { agentInstructions } from '../instructions.js';
import { PLUGIN_ROOT } from '../settings.js';

/**
 * The modding agents' system prompt: the core's instructions, then what only OpenClaw's agents need — its own file
 * tools. Each line with the eval round behind it (docs/research/local-model-evals.md, beside the repositories);
 * until 2026-10-25 they were in the workspace AGENTS.md the MCP server's setup wrote.
 */

const target = 'the Mod Organizer instance at G:\\Modding\\SkyrimSE-Test';
const text = agentInstructions(target);
const own = text.slice(serverInstructions(target).length);

describe('the modding agents\' instructions', () => {
    it('are the core\'s, then the lines about OpenClaw\'s file tools', () => {
        expect(text.startsWith(serverInstructions(target))).toBe(true);
        expect(own).toMatch(/^\n\nYour file tools:\n/);
    });

    it('tell the agent to write a whole record anew, and to edit only a few lines', () => {
        // Rounds 31–58: 16 of e4b's failed runs ended on an `edit` call that Ollama dropped unparsed — its `edits` list
        // never closed, its texts mostly whole record files (ollama/ollama#19273). Its writes were dropped once.
        expect(own).toContain('- A whole record, or a file changed in many places, you `write` anew; `edit` is for a few lines.');
    });

    it('tell the agent that an edit\'s old text holds real line breaks, and to read the file when an edit is refused', () => {
        // Round 29: e4b sent `oldText: "FormKey: 012EB7:Skyrim.esm\\n"` six times, the edit tool's "escaping differs"
        // hint notwithstanding, and spent the run's last turns on edits of lines it had changed already.
        expect(own).toContain('real line breaks — never `\\n` typed');
        expect(own).toMatch(/`edit` refused: `read` the file/);
    });

    it('name only file tools the README has the modding agents allow', () => {
        const readme = fs.readFileSync(path.join(PLUGIN_ROOT, 'README.md'), 'utf8');
        const allowed = JSON.parse(readme.match(/allow: (\[[^\]]*\])/)![1]) as string[];
        for (const [, name] of own.matchAll(/`([a-z_]+)`/g)) expect(allowed, name).toContain(name);
    });
});
