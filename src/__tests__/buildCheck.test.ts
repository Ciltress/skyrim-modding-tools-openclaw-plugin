import path from 'node:path';
import { BuildCheck, endsWithAnswer, filePaths } from '../buildCheck.js';

/** The check that a modding agent builds what it changed before it answers. */

const projects = path.resolve('/modding/projects');
const agent = { agentId: 'skyrim-e4b', runId: 'run-1' };
const check = () => new BuildCheck(projects, ['skyrim-e4b']);
const call = (toolName: string, params: Record<string, unknown>, extra: { error?: string } = {}) =>
    ({ toolName, params, runId: 'run-1', ...extra });

describe('BuildCheck', () => {
    it('asks once more when a project was changed with editRecord and never built', () => {
        const c = check();
        c.afterToolCall(call('editRecord', { project: 'FlameBlade', file: 'x.yaml' }), agent);
        const revision = c.beforeFinalize(agent)!;
        expect(revision.action).toBe('revise');
        expect(revision.retry.maxAttempts).toBe(1);
        expect(revision.retry.instruction).toContain('buildProject {"project":"FlameBlade"}');
        expect(revision.retry.instruction).toMatch(/only a build that answers success writes the plugin/);
        // The user's word wins: a project they asked to keep unbuilt is not built behind their back.
        expect(revision.retry.instruction).toMatch(/only if the user asked you not to build/);
    });

    it('is satisfied by a build of that project after the change, whatever the letter case', () => {
        const c = check();
        c.afterToolCall(call('addPatch', { project: 'FlameBlade', records: ['IronSword'] }), agent);
        c.afterToolCall(call('buildProject', { project: 'flameblade' }), agent);
        expect(c.beforeFinalize(agent)).toBeUndefined();
    });

    it('counts a project only made, and the tools that write cells, land and navmeshes, as changes', () => {
        for (const tool of ['newProject', 'editTerrain', 'generateNavmesh', 'newCell', 'newWorldspace', 'importCell', 'moveRecord']) {
            const c = check();
            c.afterToolCall(call(tool, { project: 'ArrivalRumor' }), agent);
            expect(c.beforeFinalize(agent)?.reason).toBe('Changed and not built since: ArrivalRumor.');
        }
    });

    it('takes deleteRecord with build as the build it made, and its refused build as a change', () => {
        const built = check();
        built.afterToolCall(call('editRecord', { project: 'AshenCamp', record: 'x' }), agent);
        built.afterToolCall(call('deleteRecord', { project: 'AshenCamp', record: 'Cells/AshenCamp.yaml', build: true }), agent);
        expect(built.beforeFinalize(agent)).toBeUndefined();
        const refused = check();
        refused.afterToolCall(call('deleteRecord', { project: 'AshenCamp', record: 'Cells/AshenCamp.yaml', build: true },
            { error: 'Deleted C:/p/AshenCamp/plugin/Cells/AshenCamp.yaml — The build after it: Not built: no records' }), agent);
        expect(refused.beforeFinalize(agent)?.reason).toBe('Changed and not built since: AshenCamp.');
    });

    it('reads the tool names as OpenClaw sends them to after_tool_call, in lower case', () => {
        const c = check();
        c.afterToolCall(call('addpatch', { project: 'ProbeBuff', records: ['IronSword'] }), agent);
        c.afterToolCall(call('editrecord', { project: 'ProbeBuff', record: 'IronSword', set: [] }), agent);
        expect(c.beforeFinalize(agent)!.reason).toBe('Changed and not built since: ProbeBuff.');
        c.afterToolCall(call('buildproject', { project: 'ProbeBuff' }), agent);
        expect(c.beforeFinalize(agent)).toBeUndefined();
    });

    it('counts a change after the build again', () => {
        const c = check();
        c.afterToolCall(call('buildProject', { project: 'FlameBlade' }), agent);
        c.afterToolCall(call('editRecord', { project: 'FlameBlade' }), agent);
        expect(c.beforeFinalize(agent)).toBeDefined();
    });

    it('does not count a refused call, nor a refused build as built', () => {
        const c = check();
        c.afterToolCall(call('editRecord', { project: 'A' }, { error: 'refused' }), agent);
        expect(c.beforeFinalize(agent)).toBeUndefined();
        c.afterToolCall(call('editRecord', { project: 'A' }), agent);
        c.afterToolCall(call('buildProject', { project: 'A' }, { error: 'Not built: …' }), agent);
        expect(c.beforeFinalize(agent)).toBeDefined();
    });

    it('counts editRecord sent with `build` as a build — but refused at that build, as a change not built', () => {
        // The rename warning's call builds since core v0.1.19: made with no build after it, it left the plugin unchanged
        // twice in eval round 75.
        const c = check();
        c.afterToolCall(call('editrecord', { project: 'FlameBlade', record: 'x.yaml' }), agent);
        c.afterToolCall(call('editrecord', { project: 'FlameBlade', record: 'x.yaml', build: true }), agent);
        expect(c.beforeFinalize(agent)).toBeUndefined();
        c.afterToolCall(call('editrecord', { project: 'FlameBlade', record: 'x.yaml', build: 'true' },
            { error: 'Changed C:\\p\\FlameBlade\\plugin\\x.yaml: set EditorID: IronSword → FlameBlade. Not built: 1 field(s) …' }), agent);
        expect(c.beforeFinalize(agent)!.reason).toBe('Changed and not built since: FlameBlade.');
        c.afterToolCall(call('editrecord', { project: 'StormBolt', record: 'x.yaml', build: true }, { error: 'No record file \'x.yaml\' …' }), agent);
        expect(c.beforeFinalize(agent)!.reason).toBe('Changed and not built since: FlameBlade.');
    });

    it('counts a file written into a project\'s plugin or scripts, relative or absolute, and nothing else', () => {
        const c = check();
        c.afterToolCall(call('write', { path: 'FlameBlade/plugin/Weapons/FlameBlade.yaml', content: '' }), agent);
        c.afterToolCall(call('edit', { path: path.join(projects, 'StormBolt', 'plugin', 'Spells', 'StormBolt.yaml') }), agent);
        c.afterToolCall(call('write', { path: 'Hilda/scripts/HildaGreeting.psc' }), agent);
        c.afterToolCall(call('write', { path: 'Other/build/Other.esp' }), agent);
        // Copied at deploy as they are: no build needed.
        c.afterToolCall(call('write', { path: 'Other/assets/meshes/shield.nif' }), agent);
        // A record file written beside the projects, in no project: eval round 64's note #4 wrote `Books/MavenWarning.yaml`
        // from the projects folder, and the check asked for a build of a project "Books".
        c.afterToolCall(call('write', { path: 'Books/MavenWarning.yaml' }), agent);
        c.afterToolCall(call('write', { path: path.resolve('/elsewhere/notes.md') }), agent);
        expect(c.beforeFinalize(agent)!.reason).toBe('Changed and not built since: FlameBlade, StormBolt, Hilda.');
    });

    it('follows only the agents that mod, and forgets a run that ended', () => {
        const c = check();
        c.afterToolCall(call('editRecord', { project: 'A' }), { agentId: 'swift', runId: 'run-1' });
        expect(c.beforeFinalize({ agentId: 'swift', runId: 'run-1' })).toBeUndefined();
        c.afterToolCall(call('editRecord', { project: 'A' }), agent);
        c.end('run-1');
        expect(c.beforeFinalize(agent)).toBeUndefined();
    });

    it('knows whether a run made a call of any tool, a refused one too, until it ends', () => {
        const c = check();
        expect(c.madeCalls('run-1')).toBe(false);
        c.afterToolCall(call('readSkill', { skill: 'skyrim-modding-basics' }, { error: 'unknown skill' }), agent);
        expect(c.madeCalls('run-1')).toBe(true);
        expect(c.madeCalls('run-2')).toBe(false);
        expect(c.madeCalls(undefined)).toBe(false);
        c.end('run-1');
        expect(c.madeCalls('run-1')).toBe(false);
        c.afterToolCall(call('read', { path: 'AGENTS.md' }), { agentId: 'swift', runId: 'run-1' });
        expect(c.madeCalls('run-1')).toBe(false);
    });
});

describe('BuildCheck, of a build with warnings', () => {
    // As OpenClaw hands a plugin tool's answer to after_tool_call: its content's text, the core's JSON.
    const answered = (status: string) => ({ content: [{ type: 'text', text: JSON.stringify({ status, warnings: status === 'success' ? [] : ['x'] }, null, 2) }] });

    // Eval round 151's leveled-npc #2 and #3 answered after a build whose warning held the call that put the game's Ice Wolf in the list.
    it('asks once more, after the build check, when the last build of a project answered built_with_warnings', () => {
        const c = check();
        c.afterToolCall({ ...call('buildProject', { project: 'IceWolves' }), result: answered('built_with_warnings') }, agent);
        const revision = c.warningsBeforeFinalize(agent)!;
        expect(revision.action).toBe('revise');
        expect(revision.reason).toBe('Built with warnings last: IceWolves.');
        expect(revision.retry.maxAttempts).toBe(1);
        expect(revision.retry.instruction).toContain('Fix what each warning says and build again: that is part of the task');
        expect(revision.retry.instruction).toContain('Leave a warning only where the user asked for just what it names, and say so');
        expect(revision.retry.idempotencyKey).toBe('skyrim-modding-tools:warnings:run-1:icewolves');
        // A change after it is the build check's first.
        c.afterToolCall(call('editRecord', { project: 'IceWolves' }), agent);
        expect(c.warningsBeforeFinalize(agent)).toBeUndefined();
        expect(c.beforeFinalize(agent)).toBeDefined();
    });

    it('takes an editRecord built with warnings, its answer quoted inside JSON too, and lets a clean build clear it', () => {
        const c = check();
        c.afterToolCall({ ...call('editRecord', { project: 'GoldLever', build: true }), result: JSON.stringify(answered('built_with_warnings')) }, agent);
        expect(c.warningsBeforeFinalize(agent)?.reason).toBe('Built with warnings last: GoldLever.');
        c.afterToolCall({ ...call('buildProject', { project: 'goldlever' }), result: answered('success') }, agent);
        expect(c.warningsBeforeFinalize(agent)).toBeUndefined();
    });

    it('asks nothing of another agent, of a refused build, or of a run that ended', () => {
        const c = check();
        c.afterToolCall({ ...call('buildProject', { project: 'A' }), result: answered('built_with_warnings') }, { agentId: 'swift', runId: 'run-1' });
        expect(c.warningsBeforeFinalize({ agentId: 'swift', runId: 'run-1' })).toBeUndefined();
        c.afterToolCall({ ...call('buildProject', { project: 'A' }), error: 'Not built: …' }, agent);
        expect(c.warningsBeforeFinalize(agent)).toBeUndefined();
        c.afterToolCall({ ...call('buildProject', { project: 'A' }), result: answered('built_with_warnings') }, agent);
        c.end('run-1');
        expect(c.warningsBeforeFinalize(agent)).toBeUndefined();
    });
});

describe('filePaths', () => {
    it('reads write and edit paths, edit lists, and apply_patch headers', () => {
        expect(filePaths('write', { path: 'a.yaml' })).toEqual(['a.yaml']);
        expect(filePaths('edit', { edits: [{ path: 'b.yaml', oldText: 'x', newText: 'y' }] })).toEqual(['b.yaml']);
        const patch = '*** Begin Patch\n*** Update File: P/plugin/x.yaml\n@@\n-a\n+b\n*** Add File: P/plugin/y.yaml\n+c\n*** End Patch';
        expect(filePaths('apply_patch', { input: patch })).toEqual(['P/plugin/x.yaml', 'P/plugin/y.yaml']);
    });
});

describe('endsWithAnswer', () => {
    it('takes only an assistant message with text the user sees as an answer', () => {
        expect(endsWithAnswer([{ role: 'assistant', content: 'Built.' }])).toBe(true);
        expect(endsWithAnswer([{ role: 'assistant', content: [{ type: 'thinking', thinking: 'x' }, { type: 'text', text: 'Built.' }] }])).toBe(true);
        expect(endsWithAnswer([{ role: 'assistant', content: [{ type: 'thinking', thinking: 'Built.' }] }])).toBe(false);
        expect(endsWithAnswer([{ role: 'assistant', content: [{ type: 'text', text: '\n' }] }])).toBe(false);
        expect(endsWithAnswer([{ role: 'assistant', content: 'Built.' }, { role: 'toolResult', content: 'ok' }])).toBe(false);
        expect(endsWithAnswer([])).toBe(false);
        expect(endsWithAnswer(undefined)).toBe(false);
    });
});
