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

    it('keeps a cell\'s path for a file in it, written with or without the project\'s folder (round 128\'s world #3)', () => {
        project('BreezehomeChest');
        const g = guard();
        g.afterToolCall(call('newProject', { project: 'BreezehomeChest' }), agent);
        const cell = ['Cells', '0', '6', 'WhiterunBreezehome - 0165A8_Skyrim.esm'];
        expect(g.beforeToolCall(call('write', { path: `plugin/${cell.join('/')}/Temporary/HuntersChestRef.yaml` }), agent))
            .toEqual({ params: { path: path.join(projects, 'BreezehomeChest', 'plugin', ...cell, 'Temporary', 'HuntersChestRef.yaml') } });
        expect(g.beforeToolCall(call('write', { path: `BreezehomeChest/${cell.join('/')}/Temporary/HuntersChestRef.yaml` }), agent))
            .toEqual({ params: { path: path.join(projects, 'BreezehomeChest', 'plugin', ...cell, 'Temporary', 'HuntersChestRef.yaml') } });
        expect(g.beforeToolCall(call('write', { path: `${cell.join('/')}/RecordData.yaml` }), agent))
            .toEqual({ params: { path: path.join(projects, 'BreezehomeChest', 'plugin', ...cell, 'RecordData.yaml') } });
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

    it('writes a script\'s source outside its project\'s scripts folder into it, and lets one there through', () => {
        // Eval round 127's quest+detailed #4: `scripts/StarterGoldScript.psc` landed in the projects folder, and its quest
        // built with the script warned missing.
        project('StarterGold');
        const g = guard();
        g.afterToolCall(call('newProject', { project: 'StarterGold' }), agent);
        const target = path.join(projects, 'StarterGold', 'scripts', 'StarterGoldScript.psc');
        for (const given of ['scripts/StarterGoldScript.psc', 'StarterGoldScript.psc', 'StarterGold/plugin/scripts/StarterGoldScript.psc',
            'StarterGold/Scripts/Source/StarterGoldScript.psc']) {
            expect(g.beforeToolCall(call('write', { path: given, content: 'ScriptName StarterGoldScript extends Quest\n' }), agent))
                .toEqual({ params: { path: target } });
        }
        for (const given of ['StarterGold/scripts/StarterGoldScript.psc', target, path.join(os.tmpdir(), 'Elsewhere.psc')]) {
            expect(g.beforeToolCall(call('write', { path: given }), agent)).toBeUndefined();
        }
        // An edit goes to the project's script where it has one, and is stopped where it has none.
        expect(g.beforeToolCall(call('edit', { path: 'scripts/StarterGoldScript.psc' }), agent)).toEqual({
            block: true,
            blockReason: expect.stringContaining(`The project has no script at ${slashed('StarterGold', 'scripts', 'StarterGoldScript.psc')}`)
        });
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, 'ScriptName StarterGoldScript extends Quest\n');
        expect(g.beforeToolCall(call('edit', { path: 'scripts/StarterGoldScript.psc' }), agent)).toEqual({ params: { path: target } });
    });

    it('stops a script\'s source written outside every project by a run that named none, naming where it goes', () => {
        const result = guard().beforeToolCall(call('write', { path: 'scripts/StarterGoldScript.psc' }), agent);
        expect(result).toEqual({
            block: true,
            blockReason: expect.stringContaining(`its project's scripts folder, beside the plugin folder: ${slashed('<project>', 'scripts', 'StarterGoldScript.psc')}`)
        });
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

    it('keeps the FormKey a build gave a record file when a write of the same record leaves it out', () => {
        // Eval round 84's npc #2 wrote its NPC again as the build had corrected it, without the FormKey line the build gave it,
        // and built no more: the text held a record not yet numbered beside the plugin built from it.
        project('HildaTheNord');
        const file = path.join(projects, 'HildaTheNord', 'plugin', 'Npcs', 'Hilda.yaml');
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, 'FormKey: 000800:HildaTheNord.esp\nEditorID: Hilda\nRace: NordRace\n');
        const g = guard();
        g.afterToolCall(call('buildProject', { project: 'HildaTheNord' }), agent);
        const rewritten = 'EditorID: Hilda\nRace: NordRace\nVoice: FemaleNord\n';

        expect(g.beforeToolCall(call('write', { path: file, content: rewritten }), agent))
            .toEqual({ params: { content: `FormKey: 000800:HildaTheNord.esp\n${rewritten}` } });
        // Placed and kept at once: the path in the plugin folder alone.
        expect(g.beforeToolCall(call('write', { path: 'Npcs/Hilda.yaml', content: rewritten.replace(/\n/g, '\r\n') }), agent))
            .toEqual({ params: { path: file, content: `FormKey: 000800:HildaTheNord.esp\r\n${rewritten.replace(/\n/g, '\r\n')}` } });
        // Written with a FormKey, or as another record, it stays as written.
        expect(g.beforeToolCall(call('write', { path: file, content: `FormKey: 000801:HildaTheNord.esp\n${rewritten}` }), agent)).toBeUndefined();
        expect(g.beforeToolCall(call('write', { path: file, content: rewritten.replace('Hilda', 'Helga') }), agent)).toBeUndefined();
        // A copy's FormKey names the record it changes: left out, the copy is made new, which the build's warnings say.
        fs.writeFileSync(file, 'FormKey: 012EB7:Skyrim.esm\nEditorID: Hilda\n');
        expect(g.beforeToolCall(call('write', { path: file, content: rewritten }), agent)).toBeUndefined();
        // An edit, and a file not there yet, are no rewrite of a numbered record.
        expect(g.beforeToolCall(call('edit', { path: file, edits: [{ oldText: 'a', newText: 'b' }] }), agent)).toBeUndefined();
        expect(g.beforeToolCall(call('write', { path: path.join(path.dirname(file), 'Helga.yaml'), content: rewritten }), agent)).toBeUndefined();
    });
});

/** The reason a decision stops the call with; a decision that does not stop it fails the test. */
function blockReason(decision: ReturnType<WriteGuard['beforeToolCall']>): string {
    if (!decision || !('block' in decision)) throw new Error(`not stopped: ${JSON.stringify(decision)}`);
    return decision.blockReason;
}
