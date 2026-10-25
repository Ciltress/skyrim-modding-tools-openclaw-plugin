import type { AnyAgentTool, OpenClawPluginApi } from 'openclaw/plugin-sdk/plugin-entry';
import {
    CORE_INFO,
    ToolError,
    ToolErrorCode,
    applyProfile,
    capToolResult,
    coerceArgs,
    createHandlers,
    evaluateGate,
    gatingEnabled,
    isPermanent,
    resolveProfile,
    resolveResponseBudget,
    type AppBackend,
    type BaseHandler,
    type GateResult,
    type HealthReport,
    type ProfileName,
    type Product,
    type ToolDefinition
} from 'skyrim-modding-tools-core';

/** What of OpenClaw's plugin API registering the tools needs. */
export type ToolApi = Pick<OpenClawPluginApi, 'registerTool'>;

/** How long to wait for the backend's capabilities or its health probe: a model turn is waiting on it. */
const GATE_TIMEOUT_MS = 8_000;
const HEALTH_TIMEOUT_MS = 5_000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    return Promise.race([
        promise,
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`${label} timed out`)), ms).unref())
    ]);
}

/** OpenClaw's mark for a failure's words to the operator, which its log shows and the model never reads (tool-operator-hint.ts). */
const OPERATOR_HINT = Symbol.for('openclaw.toolOperatorHint');

/**
 * What a failed call answers the model: the core's message as plain text, which OpenClaw writes into its own JSON —
 * `[tool error] {"status": "error", "tool": "buildproject", "error": "Not built: …"}`. Sent as the MCP server's
 * `{"error", "code"}` JSON, it was a text inside that JSON, each backslash of a path written four times, and e4b left two
 * records outside their project though the refusal named each one's place (eval round 65's spell #5 and npc #4).
 */
export function failureText(error: unknown): string {
    return (error instanceof Error ? error.message : String(error)) || 'Internal error';
}

/** A failed call as OpenClaw is to throw it: its text for the model, its JSON-RPC code for OpenClaw's log alone. */
export function failure(error: unknown): Error {
    const code = error instanceof ToolError ? error.code : ToolErrorCode.InternalError;
    const failed = new Error(failureText(error));
    Object.defineProperty(failed, OPERATOR_HINT, { value: `[code ${code}]`, configurable: true, enumerable: false, writable: true });
    return failed;
}

/** healthcheck is the plugin's own, as it is the MCP server's: it must answer when nothing else does. */
const HEALTHCHECK: ToolDefinition = {
    name: 'healthcheck',
    annotations: {
        title: 'Health and identity',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
    },
    description:
        'What these tools are bound to — the mod manager\'s instance — whether it answers, and per-family call ' +
        'metrics. Call it when calls start failing, or to find out which instance a request would change. It never ' +
        'connects to the backend, so it answers when everything else fails. Also reports the active tool profile, ' +
        'the response budget, and anything withheld because the backend does not support it.',
    inputSchema: { type: 'object', properties: {} }
};

/**
 * The core's tools as OpenClaw tools, under their own names, kept to the rules the MCP server keeps (its
 * server.ts): the profile decides what is offered, every answer passes the response budget, the capability gate
 * withholds what the backend cannot serve, a session the backend dropped is retried once, a refused credential
 * is never retried.
 */
export class SkyrimTools {
    readonly handlers: BaseHandler[];
    readonly profile: ProfileName;
    /** Ceiling on one answer in bytes; 0 means none. */
    readonly budget: number;
    /** The profile's tools, healthcheck last. */
    readonly listed: ToolDefinition[];
    private readonly routes = new Map<string, { handler: BaseHandler; definition: ToolDefinition }>();
    private gate: GateResult = { unavailable: new Map(), missing: [] };
    private gatePromise?: Promise<void>;
    private permanentFailure?: Error;

    constructor(readonly backend: AppBackend, readonly product: Product, private readonly env: NodeJS.ProcessEnv) {
        this.handlers = createHandlers(backend, product);
        this.profile = resolveProfile(env);
        this.budget = resolveResponseBudget(this.profile, env);
        const offered = this.handlers.flatMap(handler => handler.getTools());
        const listed = new Set(applyProfile(this.profile, offered).map(tool => tool.name));
        for (const handler of this.handlers) {
            for (const definition of handler.getTools()) {
                if (listed.has(definition.name) && !this.routes.has(definition.name)) this.routes.set(definition.name, { handler, definition });
            }
        }
        this.listed = [...[...this.routes.values()].map(route => route.definition), HEALTHCHECK];
    }

    /** Every tool name the plugin can register, in order: what openclaw.plugin.json's contracts.tools lists. */
    toolNames(): string[] {
        return this.listed.map(tool => tool.name);
    }

    /**
     * Registers each tool as optional — an agent sees it only when its tools.allow names it or the plugin — and as
     * a factory, so a tool the gate withholds is left out of the next run's tools.
     */
    register(api: ToolApi): void {
        for (const definition of this.listed) {
            api.registerTool(
                () => (this.gate.unavailable.has(definition.name) ? null : this.agentTool(definition)),
                { name: definition.name, optional: true }
            );
        }
    }

    /** One tool, as OpenClaw runs it. */
    agentTool(definition: ToolDefinition): AnyAgentTool {
        return {
            name: definition.name,
            label: definition.annotations?.title ?? definition.name,
            description: definition.description,
            // Plain JSON Schema: OpenClaw normalizes every tool's parameters, an MCP tool's alike.
            parameters: definition.inputSchema as unknown as AnyAgentTool['parameters'],
            // Outside Tool Search's catalog, so a small model sees it without searching for it.
            catalogMode: 'direct-only',
            // One at a time, as OpenClaw ran the MCP server's tools: they share one helper and one load order.
            executionMode: 'sequential',
            // OpenClaw checks the arguments against the schema before the tool runs: the core's repair comes first.
            prepareArguments: (args: unknown) => coerceArgs(definition.inputSchema, args ?? {}),
            execute: async (_toolCallId: string, params: unknown) => {
                try {
                    const result = await this.call(definition.name, params);
                    return { content: result.content, details: {} };
                } catch (error) {
                    // Thrown, as OpenClaw asks of a failed tool: the model reads the message as the call's result.
                    throw failure(error);
                }
            }
        };
    }

    /** Runs one tool and returns its answer within the budget. Throws a ToolError, or what the backend threw. */
    async call(name: string, args: unknown): Promise<{ content: { type: 'text'; text: string }[] }> {
        if (name === HEALTHCHECK.name) return this.capped(name, this.envelope(await this.healthcheck()));

        await this.ensureGate();
        const withheld = this.gate.unavailable.get(name);
        if (withheld) throw new ToolError(ToolErrorCode.InvalidRequest, withheld);

        const route = this.routes.get(name);
        if (!route) throw new ToolError(ToolErrorCode.MethodNotFound, `Unknown tool: ${name}`);

        if (!this.backend.connected) await this.ensureConnected();
        let envelope;
        try {
            envelope = await route.handler.handle(name, args);
        } catch (error) {
            // Safe to retry only what was refused before it ran: the backend says which (server.ts, part two).
            if (!this.isSessionExpired(error)) throw error;
            await this.ensureConnected();
            envelope = await route.handler.handle(name, args);
        }
        return this.capped(name, envelope, route);
    }

    private capped(name: string, envelope: any, route?: { handler: BaseHandler; definition: ToolDefinition }) {
        const capped = capToolResult(name, envelope, this.budget, route?.definition.narrowingHint);
        route?.handler.trackResponseBytes(capped.bytes, capped.truncated);
        return capped.result as { content: { type: 'text'; text: string }[] };
    }

    private envelope(payload: unknown) {
        return { content: [{ type: 'text' as const, text: JSON.stringify(payload) }] };
    }

    private async ensureConnected(): Promise<void> {
        if (this.permanentFailure) throw this.permanentFailure;
        try {
            await this.backend.connect();
        } catch (error) {
            if (isPermanent(error)) this.permanentFailure = error as Error;
            throw error;
        }
    }

    /**
     * Evaluates the capability gate once, and never lets it break anything: every failure leaves the gate empty
     * and every tool offered, because hiding a tool that would have worked is invisible.
     */
    ensureGate(): Promise<void> {
        this.gatePromise ??= (async () => {
            if (!gatingEnabled(this.env)) return;
            try {
                if (!this.backend.connected) await this.ensureConnected();
                const capabilities = await withTimeout(this.backend.capabilities(), GATE_TIMEOUT_MS, 'capabilities');
                this.gate = evaluateGate(capabilities, this.handlers.flatMap(handler => handler.getTools()));
            } catch {
                // Deliberately swallowed: see above.
            }
        })();
        return this.gatePromise;
    }

    private isSessionExpired(error: unknown): boolean {
        for (let current = error, depth = 0; current && depth < 5; depth++) {
            if (this.backend.isSessionExpired(current)) return true;
            current = (current as { cause?: unknown }).cause;
        }
        return false;
    }

    private async checkHealth(): Promise<{ checked: false } | ({ checked: true } & HealthReport)> {
        if (!this.backend.health) return { checked: false };
        try {
            return { checked: true, ...(await withTimeout(this.backend.health(), HEALTH_TIMEOUT_MS, 'health probe')) };
        } catch (error) {
            return { checked: true, ok: false, summary: `The health probe itself failed: ${(error as Error)?.message ?? error}` };
        }
    }

    private async healthcheck() {
        const health = await this.checkHealth();
        return {
            status: (health.checked && !health.ok) || this.permanentFailure ? 'degraded' : 'healthy',
            timestamp: new Date().toISOString(),
            plugin: { name: this.product.name, version: this.product.version },
            core: CORE_INFO,
            boundTo: this.backend.describe(),
            health,
            session: {
                connected: this.backend.connected,
                ...(this.permanentFailure ? { refused: this.permanentFailure.message, retried: false } : {})
            },
            tools: {
                profile: this.profile,
                responseBudgetBytes: this.budget,
                listed: this.listed.filter(tool => !this.gate.unavailable.has(tool.name)).length,
                backendMissing: this.gate.missing,
                withheldForBackend: [...this.gate.unavailable.keys()]
            },
            metrics: Object.fromEntries(this.handlers.map(handler => [handler.constructor.name, handler.getMetrics()]))
        };
    }
}
