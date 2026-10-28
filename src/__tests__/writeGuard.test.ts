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
    it('writes a record file sent from the projects folder into the run\'s project, at its path there', () => {
        // Eval round 68's note+detailed #1: the build named the file by its path in the plugin folder, and the model wrote its
        // fixes there, from the projects folder, 6 times. Round 71's note+detailed #5, stopped with the path in the
        // project, sent the same write three times, and OpenClaw ended the run.
        project('MavenNote');
        const g = guard();
        g.afterToolCall(call('moverecord', { project: 'MavenNote', from: 'x', to: 'y' }), agent);

        expect(g.beforeToolCall(call('write', { path: 'Books/MavenWarning - 0F68A3_Skyrim.esm.yaml', content: 'x' }), agent))
            .toEqual({ params: { path: path.join(projects, 'MavenNote', 'plugin', 'Books', 'MavenWarning - 0F68A3_Skyrim.esm.yaml') } });
    });

    it('places a path written with plugin/ but without the project\'s folder, one in the project\'s own folder, and a file_path', () => {
        project('StormBolt');
        project('HildaTheNord');
        const g = guard();
        g.afterToolCall(call('newProject', { project: 'StormBolt' }), agent);
        expect(g.beforeToolCall(call('write', { path: 'plugin/Spells/StormBolt.yaml' }), agent))
            .toEqual({ params: { path: path.join(projects, 'StormBolt', 'plugin', 'Spells', 'StormBolt.yaml') } });
        // In a project's folder, outside its plugin folder: that project, whichever the run named last.
        expect(g.beforeToolCall(call('write', { path: 'HildaTheNord/Npcs/Hilda.yaml' }), agent))
            .toEqual({ params: { path: path.join(projects, 'HildaTheNord', 'plugin', 'Npcs', 'Hilda.yaml') } });
        expect(g.beforeToolCall(call('write', { file_path: 'Spells/StormBolt.yaml' }), agent))
            .toEqual({ params: { file_path: path.join(projects, 'StormBolt', 'plugin', 'Spells', 'StormBolt.yaml') } });
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

    it('acts only for the agents that mod', () => {
        const g = guard();
        expect(g.beforeToolCall(call('write', { path: 'Books/MavenWarning.yaml' }), { agentId: 'swift', runId: 'run-1' })).toBeUndefined();
        expect(g.beforeToolCall(call('write', { path: 'Books/MavenWarning.yaml' }), agent)).toBeDefined();
    });

    it('stops what it cannot place: a run that named no project, a file with no group folder', () => {
        project('MavenNote');
        const g = guard();
        expect(blockReason(g.beforeToolCall(call('write', { path: 'Books/MavenWarning.yaml' }), agent)))
            .toMatch(new RegExp(`goes into its project's plugin folder, ${slashed('<project>', 'plugin', 'Books', 'MavenWarning.yaml')} — newProject answers where\\.$`));
        g.afterToolCall(call('newProject', { project: 'MavenNote' }), agent);
        expect(blockReason(g.beforeToolCall(call('write', { path: 'MavenWarning.yaml' }), agent)))
            .toMatch(/Write it into its type's group folder in .*MavenNote\/plugin, as newProject's writeRecordsTo names them/);
    });

    it('sends an edit to the project\'s file, or stops it with the move that brings the file there first', () => {
        project('MavenNote');
        const g = guard();
        g.afterToolCall(call('editRecord', { project: 'MavenNote', record: 'x' }), agent);
        put('Books/MavenWarning.yaml');
        const edit = call('edit', { path: 'Books/MavenWarning.yaml', edits: [{ oldText: 'a', newText: 'b' }] });
        expect(blockReason(g.beforeToolCall(edit, agent))).toMatch(new RegExp(`Not edited: .*Move it into the project first — ` +
            `moveRecord \\{"project": "MavenNote", "from": "${slashed('Books', 'MavenWarning.yaml')}", "to": "Books/MavenWarning.yaml"\\}`));
        put('MavenNote/plugin/Books/MavenWarning.yaml');
        expect(g.beforeToolCall(edit, agent))
            .toEqual({ params: { path: path.join(projects, 'MavenNote', 'plugin', 'Books', 'MavenWarning.yaml') } });
    });

    it('places the paths inside an edit\'s list of edits too, keeping the rest of each', () => {
        project('MavenNote');
        put('MavenNote/plugin/Books/MavenWarning.yaml');
        const g = guard();
        g.afterToolCall(call('newProject', { project: 'MavenNote' }), agent);
        const edits = [{ path: 'Books/MavenWarning.yaml', oldText: 'a', newText: 'b' }, { path: 'notes.md', oldText: 'c', newText: 'd' }];
        expect(g.beforeToolCall(call('edit', { edits }), agent)).toEqual({ params: { edits: [
            { path: path.join(projects, 'MavenNote', 'plugin', 'Books', 'MavenWarning.yaml'), oldText: 'a', newText: 'b' },
            { path: 'notes.md', oldText: 'c', newText: 'd' }
        ] } });
    });

    it('takes the project from calls that succeeded, and forgets it when the run ends', () => {
        project('MavenNote');
        const g = guard();
        g.afterToolCall(call('newProject', { project: 'Typo' }, { error: 'no such project' }), agent);
        expect(blockReason(g.beforeToolCall(call('write', { path: 'Books/MavenWarning.yaml' }), agent))).toContain('<project>');
        g.afterToolCall(call('newProject', { project: 'MavenNote' }), agent);
        expect(g.beforeToolCall(call('write', { path: 'Books/MavenWarning.yaml' }), agent))
            .toEqual({ params: { path: path.join(projects, 'MavenNote', 'plugin', 'Books', 'MavenWarning.yaml') } });
        g.end('run-1');
        expect(blockReason(g.beforeToolCall(call('write', { path: 'Books/MavenWarning.yaml' }), agent))).toContain('<project>');
    });
});

/** The reason a decision stops the call with; a decision that does not stop it fails the test. */
function blockReason(decision: ReturnType<WriteGuard['beforeToolCall']>): string {
    if (!decision || !('block' in decision)) throw new Error(`not stopped: ${JSON.stringify(decision)}`);
    return decision.blockReason;
}
