import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WriteGuard } from '../writeGuard.js';

/** The guard that keeps a modding agent's record files where a build reads them. */

let projects: string;
const agent = { agentId: 'skyrim-e4b', runId: 'run-1' };
const guard = () => new WriteGuard(projects, agentId => agentId === 'skyrim-e4b');
const call = (toolName: string, params: Record<string, unknown>, extra: { error?: string } = {}) =>
    ({ toolName, params, runId: 'run-1', ...extra });
const slashed = (...parts: string[]) => path.join(projects, ...parts).split(path.sep).join('/');
const project = (name: string) => {
    fs.mkdirSync(path.join(projects, name, 'plugin'), { recursive: true });
    fs.writeFileSync(path.join(projects, name, 'plugin', 'RecordData.yaml'), `ModKey: ${name}.esp\n`);
};
const put = (relative: string) => {
    fs.mkdirSync(path.dirname(path.join(projects, relative)), { recursive: true });
    fs.writeFileSync(path.join(projects, relative), 'EditorID: X\n');
};

beforeEach(() => { projects = fs.mkdtempSync(path.join(os.tmpdir(), 'write-guard-')); });
afterEach(() => { fs.rmSync(projects, { recursive: true, force: true }); });

describe('WriteGuard', () => {
    it('stops a record file written from the projects folder, naming its full path in the run\'s project', () => {
        // Eval round 68's note+detailed #1: the build named the file by its path in the plugin folder, and e4b wrote its
        // fixes there, from the projects folder, 6 times.
        project('MavenNote');
        const g = guard();
        g.afterToolCall(call('moverecord', { project: 'MavenNote', from: 'x', to: 'y' }), agent);

        const block = g.beforeToolCall(call('write', { path: 'Books/MavenWarning - 0F68A3_Skyrim.esm.yaml', content: '' }), agent)!;

        expect(block.block).toBe(true);
        expect(block.blockReason).toBe(`Not written: Books/MavenWarning - 0F68A3_Skyrim.esm.yaml is ` +
            `${slashed('Books', 'MavenWarning - 0F68A3_Skyrim.esm.yaml')}: in the projects folder, outside every project's plugin ` +
            `folder, where no build reads it — a relative path starts at the projects folder. Write it to its full path in the ` +
            `project: ${slashed('MavenNote', 'plugin', 'Books', 'MavenWarning - 0F68A3_Skyrim.esm.yaml')}`);
    });

    it('places a path written with plugin/ but without the project\'s folder, and one in the project\'s own folder', () => {
        project('StormBolt');
        project('HildaTheNord');
        const g = guard();
        g.afterToolCall(call('newProject', { project: 'StormBolt' }), agent);
        expect(g.beforeToolCall(call('write', { path: 'plugin/Spells/StormBolt.yaml' }), agent)!.blockReason)
            .toMatch(new RegExp(`Write it to its full path in the project: ${slashed('StormBolt', 'plugin', 'Spells', 'StormBolt.yaml')}$`));
        // In a project's folder, outside its plugin folder: that project, whichever the run named last.
        expect(g.beforeToolCall(call('write', { path: 'HildaTheNord/Npcs/Hilda.yaml' }), agent)!.blockReason)
            .toMatch(new RegExp(`${slashed('HildaTheNord', 'plugin', 'Npcs', 'Hilda.yaml')}$`));
    });

    it('lets a file into a project\'s plugin folder through, by a relative or a full path, and anything that is no record file', () => {
        project('MavenNote');
        const g = guard();
        g.afterToolCall(call('newProject', { project: 'MavenNote' }), agent);
        for (const params of [
            { path: 'MavenNote/plugin/Books/MavenWarning.yaml' },
            { path: path.join(projects, 'MavenNote', 'plugin', 'Books', 'MavenWarning.yaml') },
            { path: 'notes.md' },
            { path: path.join(os.tmpdir(), 'elsewhere.yaml') },
            { file_path: 'MavenNote/plugin/Books/MavenWarning.yaml' }
        ]) {
            expect(g.beforeToolCall(call('write', params), agent)).toBeUndefined();
        }
        expect(g.beforeToolCall(call('read', { path: 'Books/MavenWarning.yaml' }), agent)).toBeUndefined();
    });

    it('stops only the agents that mod', () => {
        const g = guard();
        expect(g.beforeToolCall(call('write', { path: 'Books/MavenWarning.yaml' }), { agentId: 'swift', runId: 'run-1' })).toBeUndefined();
        expect(g.beforeToolCall(call('write', { path: 'Books/MavenWarning.yaml' }), agent)).toBeDefined();
    });

    it('names the project\'s folder for a run that named none, and the group folder for a file with none', () => {
        project('MavenNote');
        const g = guard();
        expect(g.beforeToolCall(call('write', { path: 'Books/MavenWarning.yaml' }), agent)!.blockReason)
            .toMatch(new RegExp(`goes into its project's plugin folder, ${slashed('<project>', 'plugin', 'Books', 'MavenWarning.yaml')} — newProject answers where\\.$`));
        g.afterToolCall(call('newProject', { project: 'MavenNote' }), agent);
        expect(g.beforeToolCall(call('write', { path: 'MavenWarning.yaml' }), agent)!.blockReason)
            .toMatch(/Write it into its type's group folder in .*MavenNote\/plugin, as newProject's writeRecordsTo names them/);
    });

    it('sends an edit to the project\'s file, or moves the file there first', () => {
        project('MavenNote');
        const g = guard();
        g.afterToolCall(call('editRecord', { project: 'MavenNote', record: 'x' }), agent);
        put('Books/MavenWarning.yaml');
        const edit = call('edit', { path: 'Books/MavenWarning.yaml', edits: [{ oldText: 'a', newText: 'b' }] });
        expect(g.beforeToolCall(edit, agent)!.blockReason).toMatch(new RegExp(`Not edited: .*Move it into the project first — ` +
            `moveRecord \\{"project": "MavenNote", "from": "${slashed('Books', 'MavenWarning.yaml')}", "to": "Books/MavenWarning.yaml"\\}`));
        put('MavenNote/plugin/Books/MavenWarning.yaml');
        expect(g.beforeToolCall(edit, agent)!.blockReason)
            .toMatch(new RegExp(`The project's file is ${slashed('MavenNote', 'plugin', 'Books', 'MavenWarning.yaml')}: edit that one\\.$`));
    });

    it('takes the project from calls that succeeded, and forgets it when the run ends', () => {
        project('MavenNote');
        const g = guard();
        g.afterToolCall(call('newProject', { project: 'Typo' }, { error: 'no such project' }), agent);
        expect(g.beforeToolCall(call('write', { path: 'Books/MavenWarning.yaml' }), agent)!.blockReason).toContain('<project>');
        g.afterToolCall(call('newProject', { project: 'MavenNote' }), agent);
        expect(g.beforeToolCall(call('write', { path: 'Books/MavenWarning.yaml' }), agent)!.blockReason).toContain('MavenNote/plugin');
        g.end('run-1');
        expect(g.beforeToolCall(call('write', { path: 'Books/MavenWarning.yaml' }), agent)!.blockReason).toContain('<project>');
    });
});
