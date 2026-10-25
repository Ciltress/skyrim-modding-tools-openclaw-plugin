import path from 'node:path';
import { BuildCheck, filePaths } from '../buildCheck.js';

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

    it('counts a file written under a project, relative or absolute, but not into its build folder', () => {
        const c = check();
        c.afterToolCall(call('write', { path: 'FlameBlade/plugin/Weapons/FlameBlade.yaml', content: '' }), agent);
        c.afterToolCall(call('edit', { path: path.join(projects, 'StormBolt', 'plugin', 'Spells', 'StormBolt.yaml') }), agent);
        c.afterToolCall(call('write', { path: 'Other/build/Other.esp' }), agent);
        c.afterToolCall(call('write', { path: path.resolve('/elsewhere/notes.md') }), agent);
        expect(c.beforeFinalize(agent)!.reason).toBe('Changed and not built since: FlameBlade, StormBolt.');
    });

    it('follows only the agents that mod, and forgets a run that ended', () => {
        const c = check();
        c.afterToolCall(call('editRecord', { project: 'A' }), { agentId: 'swift', runId: 'run-1' });
        expect(c.beforeFinalize({ agentId: 'swift', runId: 'run-1' })).toBeUndefined();
        c.afterToolCall(call('editRecord', { project: 'A' }), agent);
        c.end('run-1');
        expect(c.beforeFinalize(agent)).toBeUndefined();
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
