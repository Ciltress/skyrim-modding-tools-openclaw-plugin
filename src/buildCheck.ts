import path from 'node:path';

/** What of OpenClaw's after_tool_call event the check reads. */
export interface ToolCallFact {
    toolName: string;
    params: Record<string, unknown>;
    runId?: string;
    error?: string;
}

/** What of an agent hook's context the check reads. */
export interface RunFact {
    agentId?: string;
    runId?: string;
}

/** What before_agent_finalize may answer: one more model pass, with an instruction. */
export interface FinalizeRevision {
    action: 'revise';
    reason: string;
    retry: { instruction: string; idempotencyKey: string; maxAttempts: number };
}

/**
 * The tools that change a project's text without a file tool, in lower case: OpenClaw's after_tool_call names a tool
 * so (`editrecord`), and with `editRecord` here the check never fired.
 */
const PROJECT_CHANGES = new Set(['addpatch', 'editrecord']);
/** The tools whose success means the project's plugin was written from its text. */
const PROJECT_BUILDS = new Set(['buildproject', 'deployproject']);
/** OpenClaw's file tools, and where a call names its file. */
const FILE_TOOLS = new Set(['write', 'edit', 'apply_patch']);

/** At most this many runs are followed at once; the oldest is dropped first. A run normally ends long before. */
const MAX_RUNS = 200;

/**
 * Which projects a run changed and did not build since, so that the run is not answered as done while the plugin
 * does not have the change: 10 of the 13 e4b runs of eval rounds 31–47 that ended on a refused build told the
 * user the mod was built, and round 63's npc #5 answered "built" after an editRecord it never built.
 *
 * Only the agents that mod are followed. A project counts as changed after a call that succeeded: addPatch or
 * editRecord with its name, or a file tool writing under its folder; it counts as built again after a
 * buildProject or deployProject of it that succeeded. Before the run's answer, a project still changed asks the
 * model, once, to build it. The MCP server's nearest equivalent is its answers' nextStep lines, which say to
 * build next.
 *
 * OpenClaw 2026.10.7 does not make that pass in such a run: it revises only a run whose every call it could replay —
 * its own `read`, `ls`, `web_search` and the like — and a plugin tool's call or a `write` is none of those. It logs
 * "before_agent_finalize requested revision after potential side effects; not rewinding" and lets the answer stand
 * (seen 2026-10-25, the gateway's embedded runner and `agent exec` alike). So the check logs what it asked for, and
 * the eval counts both.
 */
export class BuildCheck {
    private readonly runs = new Map<string, Map<string, string>>();

    /**
     * @param projectsDir The projects folder. A relative file path is taken from it: the modding agents work there.
     * @param agents The agents that mod.
     */
    constructor(private readonly projectsDir: string, private readonly agents: readonly string[]) { }

    applies(agentId: string | undefined): boolean {
        return !!agentId && this.agents.includes(agentId);
    }

    /** after_tool_call: what the call did to which project. */
    afterToolCall(event: ToolCallFact, context: RunFact): void {
        if (!this.applies(context.agentId) || event.error) return;
        const runId = event.runId ?? context.runId;
        if (!runId) return;

        const named = typeof event.params?.project === 'string' ? event.params.project.trim() : '';
        const tool = event.toolName.toLowerCase();
        if (PROJECT_BUILDS.has(tool)) {
            if (named) this.runs.get(runId)?.delete(named.toLowerCase());
            return;
        }
        const changed = PROJECT_CHANGES.has(tool) ? (named ? [named] : [])
            : FILE_TOOLS.has(tool) ? this.projectsWritten(tool, event.params)
                : [];
        if (!changed.length) return;
        const run = this.run(runId);
        for (const project of changed) run.set(project.toLowerCase(), project);
    }

    /** before_agent_finalize: one more pass while a changed project is not built. */
    beforeFinalize(context: RunFact, runId = context.runId): FinalizeRevision | undefined {
        if (!this.applies(context.agentId) || !runId) return undefined;
        const unbuilt = [...(this.runs.get(runId)?.values() ?? [])];
        if (!unbuilt.length) return undefined;
        const names = unbuilt.map(project => `${project}`).join(', ');
        const calls = unbuilt.map(project => `buildProject {"project":"${project}"}`).join(', then ');
        return {
            action: 'revise',
            reason: `Changed and not built since: ${names}.`,
            retry: {
                instruction:
                    `Before you answer: ${unbuilt.length === 1 ? `the project ${names} was` : `the projects ${names} were`} ` +
                    `changed after ${unbuilt.length === 1 ? 'its' : 'their'} last build, so the plugin does not have the ` +
                    `change yet. Call ${calls} and fix what it reports — only a build that answers success writes the plugin. ` +
                    `Leave it unbuilt only if the user asked you not to build.`,
                idempotencyKey: `skyrim-modding-tools:build:${runId}:${unbuilt.map(p => p.toLowerCase()).sort().join(',')}`,
                maxAttempts: 1
            }
        };
    }

    /** agent_end: the run is over. */
    end(runId: string | undefined): void {
        if (runId) this.runs.delete(runId);
    }

    private run(runId: string): Map<string, string> {
        let run = this.runs.get(runId);
        if (!run) {
            if (this.runs.size >= MAX_RUNS) this.runs.delete(this.runs.keys().next().value!);
            this.runs.set(runId, run = new Map());
        }
        return run;
    }

    /** The projects a file tool's call wrote into: the first folder of each path under the projects folder. */
    private projectsWritten(toolName: string, params: Record<string, unknown>): string[] {
        const projects = new Set<string>();
        for (const file of filePaths(toolName, params)) {
            const relative = path.relative(this.projectsDir, path.resolve(this.projectsDir, file));
            if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) continue;
            const [project, ...rest] = relative.split(/[\\/]/);
            // A project's build output is not its text.
            if (project && rest.length && rest[0].toLowerCase() !== 'build') projects.add(project);
        }
        return [...projects];
    }
}

/** The files a call of OpenClaw's write, edit or apply_patch names. */
export function filePaths(toolName: string, params: Record<string, unknown>): string[] {
    const paths: string[] = [];
    const add = (value: unknown) => { if (typeof value === 'string' && value.trim()) paths.push(value.trim()); };
    add(params?.path);
    add(params?.file_path);
    if (Array.isArray(params?.edits)) for (const edit of params.edits) add((edit as Record<string, unknown>)?.path);
    if (toolName === 'apply_patch') {
        const patch = [params?.input, params?.patch].find(value => typeof value === 'string') as string | undefined;
        for (const match of patch?.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm) ?? []) add(match[1]);
    }
    return paths;
}
