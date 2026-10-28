import fs from 'node:fs';
import path from 'node:path';
import type { RunFact, ToolCallFact } from './buildCheck.js';

/** What of OpenClaw's before_tool_call event the guard reads. */
export interface ToolCallIntent {
    toolName: string;
    params: Record<string, unknown>;
    runId?: string;
}

/** What before_tool_call may answer to stop a call: it is not made, and the model reads the reason as its result. */
export interface ToolCallBlock {
    block: true;
    blockReason: string;
}

/** What before_tool_call may answer to change a call: OpenClaw merges these parameters over the model's. */
export interface ToolCallChange {
    params: Record<string, unknown>;
}

/** Where a file tool's path goes instead, or why the call is stopped; nothing for a path that stays as it is. */
type Placement = { target: string } | { reason: string } | undefined;

/** OpenClaw's file tools that write a file whole or in part. */
const WRITES = new Set(['write', 'edit']);

/** At most this many runs are followed at once; the oldest is dropped first. A run normally ends long before. */
const MAX_RUNS = 200;

/**
 * Keeps a modding agent's write or edit of a record file from landing in the projects folder outside every project's
 * plugin folder, where no build reads it. Such a file is written into its project, at its group folder and name there,
 * and OpenClaw's answer names that path ("Successfully wrote … to <path>"). What the guard cannot place — a run that
 * named no project, a file with no group folder, an edit of a file only outside the project — it stops, naming where
 * the file goes.
 *
 * A file tool takes a relative path from the agent's folder, the projects folder, and the model writes record files by their
 * path in the plugin folder, as the build's answers name them: `Books/MavenWarning.yaml` landed outside every project
 * in 5 to 6 of 40 authoring runs a round (eval rounds 64–68). After a refusal it wrote its fixes there 6 times while
 * the build read the copy in the project, unchanged, and told the user the note was built (round 68's
 * note+detailed #1). Stopped with the path in the project, the model wrote there next in most runs (rounds 69–71), but round
 * 71's note+detailed #5 sent the same write three times and OpenClaw ended the run: what the guard can place, it places.
 *
 * The project is the folder the path names when it is one, or else the one the run's last call of a plugin tool
 * named. OpenClaw's tool names only: an MCP client has no such hook, and the build's answers name each misplaced
 * file with its moveRecord call there.
 */
export class WriteGuard {
    private readonly projects = new Map<string, string>();

    /**
     * @param projectsDir The projects folder. A relative file path is taken from it: the modding agents work there.
     * @param applies Whether an agent mods.
     */
    constructor(private readonly projectsDir: string, private readonly applies: (agentId: string | undefined) => boolean) { }

    /** after_tool_call: the project the run works on, as a call that succeeded named it. */
    afterToolCall(event: ToolCallFact, context: RunFact): void {
        if (!this.applies(context.agentId) || event.error) return;
        const runId = event.runId ?? context.runId;
        const named = typeof event.params?.project === 'string' ? event.params.project.trim() : '';
        if (!runId || !named) return;
        this.projects.delete(runId);
        if (this.projects.size >= MAX_RUNS) this.projects.delete(this.projects.keys().next().value!);
        this.projects.set(runId, named);
    }

    /**
     * before_tool_call: a write or edit of a record file where no build reads it goes to the file in its project, or is
     * not made. The paths are the tool's `path`, `file_path` and each of its `edits`' `path`.
     */
    beforeToolCall(event: ToolCallIntent, context: RunFact): ToolCallBlock | ToolCallChange | undefined {
        const tool = event.toolName.toLowerCase();
        if (!WRITES.has(tool) || !this.applies(context.agentId)) return undefined;
        const project = this.projects.get(event.runId ?? context.runId ?? '');
        const params = event.params ?? {};
        const changed: Record<string, unknown> = {};
        for (const key of ['path', 'file_path']) {
            const placement = this.place(tool, params[key], project);
            if (placement && 'reason' in placement) return { block: true, blockReason: placement.reason };
            if (placement) changed[key] = placement.target;
        }
        if (Array.isArray(params.edits)) {
            const edits: unknown[] = [];
            for (const edit of params.edits as unknown[]) {
                const fields = edit as Record<string, unknown> | undefined;
                const placement = this.place(tool, fields?.path, project);
                if (placement && 'reason' in placement) return { block: true, blockReason: placement.reason };
                edits.push(placement ? { ...fields, path: placement.target } : edit);
            }
            if (edits.some((edit, i) => edit !== (params.edits as unknown[])[i])) changed.edits = edits;
        }
        return Object.keys(changed).length ? { params: changed } : undefined;
    }

    /** agent_end: the run is over. */
    end(runId: string | undefined): void {
        if (runId) this.projects.delete(runId);
    }

    /**
     * Where a file tool's path that no build reads goes in its project, or why it cannot go there, with where it
     * would; nothing for any other path.
     */
    private place(tool: string, value: unknown, runProject: string | undefined): Placement {
        if (typeof value !== 'string' || !value.trim()) return undefined;
        const given = value.trim();
        const file = path.resolve(this.projectsDir, given);
        const relative = path.relative(this.projectsDir, file);
        if (!/\.ya?ml$/i.test(file) || !relative || relative.startsWith('..') || path.isAbsolute(relative)) return undefined;
        const parts = relative.split(/[\\/]/);
        const inProject = parts.length > 1 && this.isProject(parts[0]);
        if (inProject && parts.length > 2 && parts[1].toLowerCase() === 'plugin') return undefined;

        // Where it belongs: its group folder and name in the project's plugin folder, a `plugin/` it was written under
        // without the project's folder dropped — as the build's moveRecord calls place such a file.
        const project = inProject ? parts[0] : runProject;
        const tail = (inProject ? parts.slice(1) : parts).filter((part, i) => i > 0 || part.toLowerCase() !== 'plugin').slice(-2);
        const slashed = (target: string) => target.split(path.sep).join('/');
        const pluginDir = project ? path.join(this.projectsDir, project, 'plugin') : undefined;
        const said = `${given} is ${slashed(file)}: in the projects folder, outside every project's plugin folder, where no build ` +
            `reads it — a relative path starts at the projects folder.`;
        if (!pluginDir) {
            return { reason: `Not ${tool === 'write' ? 'written' : 'edited'}: ${said} A record file goes into its project's plugin folder, ` +
                `${slashed(path.join(this.projectsDir, '<project>', 'plugin', ...(tail.length === 2 ? tail : ['<group folder>', ...tail])))} — ` +
                `newProject answers where.` };
        }
        if (tail.length < 2) {
            return { reason: `Not ${tool === 'write' ? 'written' : 'edited'}: ${said} Write it into its type's group folder in ` +
                `${slashed(pluginDir)}, as newProject's writeRecordsTo names them — a new weapon as ${slashed(path.join(pluginDir, 'Weapons', tail[0]))}.` };
        }
        const target = path.join(pluginDir, ...tail);
        if (tool === 'write' || fs.existsSync(target)) return { target };
        return {
            reason: fs.existsSync(file)
                ? `Not edited: ${said} Move it into the project first — moveRecord {"project": ${JSON.stringify(project)}, ` +
                    `"from": ${JSON.stringify(slashed(file))}, "to": ${JSON.stringify(tail.join('/'))}} — then edit ${slashed(target)}.`
                : `Not edited: ${said} The project has no file at ${slashed(target)}.`
        };
    }

    private isProject(folder: string): boolean {
        return fs.existsSync(path.join(this.projectsDir, folder, 'plugin', 'RecordData.yaml'));
    }
}
