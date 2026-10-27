/**
 * The eval's client: OpenClaw itself, headless (`openclaw agent exec`), with the model served by Ollama, or by a server
 * with OpenAI's API that the user's configuration names as an `openai-completions` provider (Strata) — the way a user
 * of OpenClaw with a local model drives this plugin. Used by eval.mjs.
 *
 * The session is the user's own OpenClaw configuration (`~/.openclaw/openclaw.json`, or --openclaw-config), changed
 * only where a measurement needs it: one agent is kept — --openclaw-agent, else the plugin's only modding agent, else
 * the only one — working in the eval's fresh projects folder; the plugin runs from this checkout on that folder, for
 * that agent, and is the only source of Skyrim tools (no MCP server of the user's); the model's provider points at a
 * logging proxy; deployProject, installMod, downloadNexusFile and disableMod are denied (they write into the instance
 * or download), and so are the shell (`exec`, `process`) and the tools that reach a paired device (`nodes`, the file
 * tools), since nobody watches the run; the agent's workspace files (AGENTS.md, SOUL.md, USER.md…) are copied into
 * each run's folder and put into the prompt, as a gateway does — `agent exec` makes its folder the workspace and
 * leaves them out unless told; an unset tool profile is set to `full`, which is what an unset one means in the
 * gateway — `agent exec` would take `coding`, which leaves out every native plugin tool; the model under test is
 * configured — with the settings of its provider's first model when it has no entry of its own — and
 * allowed; the gateway section is left out. Everything else is the user's — Tool Search, the thinking level, the
 * context, the plugin's hooks — so what is measured is what they get.
 *
 * `agent exec` loads the plugin in registrationMode `discovery`: its tools and hooks run, its service does not, and
 * the helper ends with the run's process.
 *
 * Everything is read at the proxy: the prompt each turn sends (OpenClaw's system prompt and tools, the num_ctx and
 * thinking it asks for), the time to the first token, how each answer ended, and the calls — each answer's tool
 * calls, and what came back for them in the next request.
 */
import { execFileSync, execSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';

/** The plugin's id, as its manifest and `plugins.entries.<id>` name it. */
export const PLUGIN_ID = 'skyrim-modding-tools';

/** The plugin's tools that change the instance or download: denied. */
export const NOT_ALLOWED = ['deployProject', 'installMod', 'downloadNexusFile', 'disableMod'];

/**
 * Denied, since an eval runs unwatched: OpenClaw's shell, and the tools that reach a paired device — on the user's
 * machine, the PC itself, through its node.
 */
const DENIED_TOOLS = ['exec', 'process', 'nodes', 'dir_fetch', 'dir_list', 'file_fetch', 'file_write'];

/** The files of an agent's workspace OpenClaw puts into its prompt. */
const WORKSPACE_FILES = ['AGENTS.md', 'SOUL.md', 'USER.md', 'IDENTITY.md', 'TOOLS.md'];

/** The configuration a user's OpenClaw reads: --openclaw-config, else OPENCLAW_CONFIG_PATH, else the default. */
export function openClawConfigFile(explicit) {
    return path.resolve(explicit ?? process.env.OPENCLAW_CONFIG_PATH ?? path.join(os.homedir(), '.openclaw', 'openclaw.json'));
}

/** OpenClaw's entry script: --openclaw, else the one npm installed globally. */
export function openClawEntry(explicit) {
    if (explicit) return path.resolve(explicit);
    try {
        // Through a shell: npm is a .cmd on Windows.
        const root = execSync('npm root -g', { encoding: 'utf8' }).trim();
        const entry = path.join(root, 'openclaw', 'openclaw.mjs');
        if (fs.existsSync(entry)) return entry;
    } catch { /* npm not on the PATH */ }
    return undefined;
}

export function openClawVersion(entry) {
    return execFileSync(process.execPath, [entry, '--version'], { encoding: 'utf8' }).trim();
}

/**
 * The server of the model's provider: `ollama` is Ollama at `ollama` (--ollama), whatever the configuration says;
 * another is a provider of the user's configuration with OpenAI's API (`openai-completions`), at its baseUrl.
 */
export function providerServer(configFile, provider, ollama) {
    if (provider === 'ollama') return { api: 'ollama', url: ollama };
    let providers = {};
    try { providers = JSON.parse(fs.readFileSync(configFile, 'utf8')).models?.providers ?? {}; } catch { /* named below */ }
    const entry = providers[provider];
    if (!entry) throw new Error(`OpenClaw's configuration ${configFile} has no provider '${provider}'; it has ${Object.keys(providers).join(', ') || 'none'}`);
    if (entry.api !== 'openai-completions' || !entry.baseUrl) {
        throw new Error(`The provider '${provider}' is no openai-completions provider with a baseUrl: the eval reads Ollama's API and OpenAI's`);
    }
    return { api: entry.api, url: entry.baseUrl };
}

/** Takes one line of Ollama's answer — a JSON object a line, or the whole unstreamed answer — into its request's entry. */
function takeOllamaLine(entry, line, started) {
    let event;
    try { event = JSON.parse(line); } catch { return; }
    const message = event.message;
    if (message) {
        if ((message.content || message.thinking || message.tool_calls) && entry.firstTokenMs === null) {
            entry.firstTokenMs = Date.now() - started;
        }
        entry.content += message.content ?? '';
        entry.thinking += message.thinking ?? '';
        if (message.tool_calls) entry.toolCalls.push(...message.tool_calls);
    }
    if (event.error) entry.error = event.error;
    if (event.done) {
        entry.done = true;
        entry.doneReason = event.done_reason;
        entry.promptTokens = event.prompt_eval_count ?? 0;
        entry.cachedTokens = event.prompt_eval_cached_count ?? 0;
        entry.outputTokens = event.eval_count ?? 0;
    }
}

/**
 * Takes one line of an OpenAI answer — a `data:` event of the stream, or the whole unstreamed answer — into its
 * request's entry. A streamed tool call comes in pieces under its index, collected in `pieces`.
 */
function takeOpenAiLine(entry, line, started, pieces) {
    const data = line.replace(/^data:\s*/, '').trim();
    if (data === '[DONE]') {
        entry.done = true;
        return;
    }
    let event;
    try { event = JSON.parse(data); } catch { return; }
    if (event.error) entry.error = event.error.message ?? event.error;
    const choice = event.choices?.[0];
    const part = choice?.delta ?? choice?.message;
    if (part) {
        const thinking = part.reasoning_content ?? part.reasoning ?? '';
        if ((part.content || thinking || part.tool_calls?.length) && entry.firstTokenMs === null) {
            entry.firstTokenMs = Date.now() - started;
        }
        entry.content += part.content ?? '';
        entry.thinking += thinking;
        for (const piece of part.tool_calls ?? []) {
            const call = (pieces[piece.index ?? pieces.length] ??= { name: '', arguments: '' });
            call.name += piece.function?.name ?? '';
            call.arguments += piece.function?.arguments ?? '';
        }
    }
    if (choice?.finish_reason) {
        entry.done = true;
        entry.doneReason = choice.finish_reason;
    }
    if (event.usage) {
        entry.promptTokens = event.usage.prompt_tokens ?? 0;
        entry.cachedTokens = event.usage.prompt_tokens_details?.cached_tokens ?? 0;
        entry.outputTokens = event.usage.completion_tokens ?? 0;
    }
}

/**
 * The tool calls of an OpenAI answer, whole, in Ollama's shape: their arguments an object, as Ollama gives them, so
 * that only arguments that do not parse stay text (a record's argsWereText).
 */
function openAiToolCalls(pieces) {
    return pieces.filter(Boolean).map(call => {
        let args = call.arguments;
        try { args = JSON.parse(call.arguments || '{}'); } catch { /* kept as text */ }
        return { function: { name: call.name, arguments: args } };
    });
}

/**
 * A pass-through to the model's server — Ollama's API, or OpenAI's (`api` openai-completions) — on a free local port;
 * `baseUrl` is the address the provider is given, the server's own path kept. Every request, and how its answer
 * streamed back, is pushed to `log`; `log.length = 0` starts a new run's record. A conversation request past `limit`
 * is refused and `onLimit` called — the eval's turn limit, which OpenClaw has no flag for.
 */
export async function startProxy(server, api = 'ollama') {
    const target = new URL(server);
    const openAi = api === 'openai-completions';
    const proxy = { url: '', baseUrl: '', log: [], limit: Infinity, onLimit: null, close: null };
    const listener = http.createServer((req, res) => {
        const started = Date.now();
        const chunks = [];
        req.on('data', c => chunks.push(c));
        req.on('end', () => {
            const raw = Buffer.concat(chunks);
            let body = null;
            try { body = raw.length ? JSON.parse(raw.toString('utf8')) : null; } catch { /* not JSON */ }
            const system = (body?.messages ?? []).filter(m => m.role === 'system').map(m => m.content ?? '').join('');
            const entry = {
                url: req.url, model: body?.model, body,
                tools: body?.tools?.length ?? 0,
                toolNames: (body?.tools ?? []).map(t => t.function?.name),
                toolsBytes: body?.tools ? Buffer.byteLength(JSON.stringify(body.tools)) : 0,
                systemChars: system.length,
                ...(openAi ? {
                    think: body?.reasoning_effort ?? body?.reasoning?.effort, numCtx: undefined,
                    numPredict: body?.max_completion_tokens ?? body?.max_tokens, temperature: body?.temperature
                } : {
                    think: body?.think, numCtx: body?.options?.num_ctx, numPredict: body?.options?.num_predict,
                    temperature: body?.options?.temperature
                }),
                status: null, firstTokenMs: null, ms: null, done: false, doneReason: null, abandoned: false,
                promptTokens: null, cachedTokens: null, outputTokens: null,
                content: '', thinking: '', toolCalls: []
            };
            proxy.log.push(entry);
            if (entry.tools > 0 && proxy.log.filter(e => e.tools > 0).length > proxy.limit) {
                entry.refused = true;
                res.writeHead(503, { 'content-type': 'application/json' });
                res.end(JSON.stringify({ error: 'the eval\'s turn limit was reached' }));
                proxy.onLimit?.();
                return;
            }
            const upstream = http.request({
                host: target.hostname, port: target.port, method: req.method, path: req.url,
                headers: { ...req.headers, host: target.host }
            }, answer => {
                entry.status = answer.statusCode;
                res.writeHead(answer.statusCode, answer.headers);
                // Ollama streams one JSON object a line, OpenAI's API one `data:` event; unstreamed, the whole answer is one.
                const decoder = new StringDecoder('utf8');
                let tail = '';
                const pieces = [];
                const take = line => {
                    if (!line.trim()) return;
                    if (openAi) takeOpenAiLine(entry, line, started, pieces);
                    else takeOllamaLine(entry, line, started);
                };
                answer.on('data', chunk => {
                    res.write(chunk);
                    const lines = (tail + decoder.write(chunk)).split('\n');
                    tail = lines.pop();
                    lines.forEach(take);
                });
                answer.on('end', () => {
                    take(tail + decoder.end());
                    if (openAi) entry.toolCalls.push(...openAiToolCalls(pieces));
                    entry.ms = Date.now() - started;
                    res.end();
                });
            });
            upstream.on('error', error => {
                if (entry.abandoned) return;
                entry.error = error.message;
                if (!res.headersSent) res.writeHead(502);
                res.end();
            });
            // Given up on, the request is ended at the server too: left open, bonsai's looping turn went on 36 minutes after
            // its run timed out at 20, and the next run's first turn waited 17 of them (eval round 33).
            res.on('close', () => {
                if (res.writableEnded) return;
                entry.abandoned = true;
                upstream.destroy();
            });
            upstream.end(raw);
        });
    });
    await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
    proxy.url = `http://127.0.0.1:${listener.address().port}`;
    proxy.baseUrl = `${proxy.url}${target.pathname.replace(/\/$/, '')}`;
    proxy.close = () => listener.close();
    return proxy;
}

/** Whether a folder holds this plugin: its manifest names the plugin's id. */
function holdsPlugin(folder) {
    try {
        return JSON.parse(fs.readFileSync(path.join(folder, 'openclaw.plugin.json'), 'utf8')).id === PLUGIN_ID;
    } catch {
        return false;
    }
}

/**
 * The session's configuration: the user's, with the changes the header names; `proxyUrl` is the address the model's
 * provider is given. Returns its file and what the run will use of it: the context OpenClaw asks Ollama for (an
 * OpenAI server's window), the model entry copied when the model had none, the agent, its workspace files, and the
 * plugin's config — the settings the eval's own reads of the instance use too.
 */
export function writeSessionConfig({ dir, configFile, proxyUrl, provider: providerId = 'ollama', model, root, projectsDir, agent, profile }) {
    let config;
    try {
        config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
    } catch (error) {
        throw new Error(`OpenClaw's configuration ${configFile} could not be read as JSON (${error.message}); ` +
            'pass --openclaw-config with a plain JSON copy of it');
    }
    if (JSON.stringify(config).includes('"$include"')) {
        throw new Error(`OpenClaw's configuration ${configFile} includes other files; pass --openclaw-config with one file that holds it all`);
    }
    const plugin = config.plugins?.entries?.[PLUGIN_ID];
    if (!plugin) {
        throw new Error(`OpenClaw's configuration ${configFile} does not set up the plugin: it has no plugins.entries.${PLUGIN_ID}`);
    }
    if (plugin.enabled === false) throw new Error(`The plugin is not enabled in OpenClaw's configuration ${configFile}`);
    delete config.gateway;

    const providers = ((config.models ??= {}).providers ??= {});
    if (providerId !== 'ollama' && !providers[providerId]) {
        throw new Error(`OpenClaw's configuration ${configFile} has no provider '${providerId}'`);
    }
    const provider = (providers[providerId] ??= { api: 'ollama', apiKey: 'ollama-local', models: [] });
    provider.baseUrl = proxyUrl;
    provider.models ??= [];
    let entry = provider.models.find(m => m.id === model);
    const copiedFrom = entry ? undefined : provider.models[0]?.id;
    if (!entry) {
        entry = { ...structuredClone(provider.models[0] ?? {}), id: model, name: model };
        provider.models.push(entry);
    }

    // The agent measured — --openclaw-agent, else the plugin's only modding agent, else the only one — kept alone, so
    // the run resolves it without the --agent flag `agent exec` does not have, and working in the eval's folder.
    const agents = (config.agents ??= {});
    const entries = agents.entries ?? {};
    const ids = Object.keys(entries);
    const modding = (plugin.config?.agents ?? []).filter(id => entries[id]);
    const agentId = agent ?? (modding.length === 1 ? modding[0] : ids.length === 1 ? ids[0] : undefined);
    if (agent && !entries[agent]) {
        throw new Error(`OpenClaw's configuration has no agent '${agent}'; it has ${ids.join(', ') || 'none'}`);
    }
    if (!agentId && ids.length > 0) {
        throw new Error(`OpenClaw's configuration has the agents ${(modding.length ? modding : ids).join(', ')}: name the one to measure with --openclaw-agent`);
    }
    // The agent's workspace files, as its gateway runs read them: from its own workspace, else the default one —
    // read once, so every run measures the same files, whatever happens to the workspace meanwhile.
    const workspace = agentId && (entries[agentId].workspace ?? (ids.length === 1 ? agents.defaults?.workspace : undefined));
    const workspaceFiles = workspace
        ? WORKSPACE_FILES.map(name => path.join(workspace.replace(/^~(?=$|[\\/])/, os.homedir()), name)).filter(file => fs.existsSync(file))
            .map(file => ({ name: path.basename(file), text: fs.readFileSync(file, 'utf8') }))
        : [];
    if (agentId) {
        agents.entries = {
            [agentId]: {
                ...entries[agentId], workspace: projectsDir, cwd: projectsDir,
                ...(workspaceFiles.length && !entries[agentId].contextInjection ? { contextInjection: 'always' } : {})
            }
        };
        // What names an agent left out — the heartbeat's, the system agent's, talk's — names the kept one,
        // or OpenClaw refuses the whole configuration.
        const removed = new Set(ids.filter(id => id !== agentId));
        (function retarget(node) {
            if (!node || typeof node !== 'object' || node === agents.entries) return;
            for (const [key, value] of Object.entries(node)) {
                if (typeof value === 'string' && /agentId$/i.test(key) && removed.has(value)) node[key] = agentId;
                else if (Array.isArray(value) && /(agents|agentIds)$/i.test(key) && value.some(v => removed.has(v))) {
                    node[key] = [...new Set(value.map(v => removed.has(v) ? agentId : v))];
                } else retarget(value);
            }
        })(config);
    }

    // The model under test is the primary one, allowed and set up wherever another model of its provider is.
    const ref = `${providerId}/${model}`;
    const defaults = (agents.defaults ??= {});
    defaults.model = { primary: ref };
    const likeIt = models => models && !models[ref]
        ? Object.keys(models).find(key => key.startsWith(`${providerId}/`))
        : undefined;
    const copyEntry = models => {
        const like = likeIt(models);
        if (like) models[ref] = structuredClone(models[like]);
    };
    copyEntry(defaults.models);
    for (const kept of Object.values(agents.entries ?? {})) {
        if (typeof kept.model === 'string') kept.model = ref;
        else if (kept.model) kept.model = { ...kept.model, primary: ref, fallbacks: [] };
        if (kept.modelPolicy?.allow && !kept.modelPolicy.allow.includes(ref)) kept.modelPolicy.allow.push(ref);
        copyEntry(kept.models);
    }

    // The plugin, from this checkout — another checkout's folder left out — on the run's projects folder, instructing
    // the measured agent. The Skyrim tools are the plugin's alone.
    const load = ((config.plugins.load ??= {}).paths ??= []);
    config.plugins.load.paths = [...load.filter(folder => path.resolve(folder) !== path.resolve(root) && !holdsPlugin(folder)), root];
    plugin.config = { ...plugin.config, projectsDir, ...(agentId ? { agents: [agentId] } : {}), ...(profile ? { profile } : {}) };
    if (config.mcp?.servers) config.mcp.servers = {};

    config.tools ??= {};
    config.tools.deny = [...new Set([...(config.tools.deny ?? []), ...DENIED_TOOLS, ...NOT_ALLOWED])];
    // Denied, they are no tool of the run: left in an agent's allow list, the file tools were "unknown entries" in
    // OpenClaw's warning on every run, though the user's own gateway has them.
    for (const kept of Object.values(config.agents?.entries ?? {})) {
        if (Array.isArray(kept.tools?.allow)) kept.tools.allow = kept.tools.allow.filter(name => !config.tools.deny.includes(name));
    }
    // Unset, the gateway filters no tool by profile and an agent's allow list decides; `agent exec` takes `coding` for
    // it, which leaves out every native plugin tool — the first probe of the plugin saw only OpenClaw's own.
    if (!config.tools.profile && !Object.values(config.agents?.entries ?? {}).some(kept => kept.tools?.profile)) {
        config.tools.profile = 'full';
    }

    const file = path.join(dir, 'openclaw.json');
    fs.writeFileSync(file, JSON.stringify(config, null, 2));
    // An OpenAI server is started with its context; contextTokens is then OpenClaw's budget below it.
    const numCtx = provider.api === 'openai-completions' ? (Number(entry.contextWindow) > 0 ? Number(entry.contextWindow) : undefined)
        : Number(entry.params?.num_ctx) > 0 ? Number(entry.params.num_ctx)
            : Number(entry.contextTokens) > 0 ? Number(entry.contextTokens) : undefined;
    return { file, numCtx, copiedFrom, agentId, workspaceFiles, pluginConfig: plugin.config };
}

/** Ends a process and what it started — OpenClaw and the plugin's helper — which Windows leaves running. */
function killTree(child) {
    if (child.exitCode !== null) return;
    if (process.platform === 'win32') {
        try { execFileSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* gone */ }
    } else {
        child.kill();
    }
}

/**
 * One answer's tool call in the record's shape. The plugin's tools keep their own names; a call through Tool Search
 * (`openclaw_tool_call` with one of them as its id) is recorded as the tool it named.
 */
export function callRecord(toolCall, turn, toolNames) {
    const name = toolCall.function?.name ?? '';
    let args = toolCall.function?.arguments ?? {};
    const argsWereText = typeof args === 'string';
    if (argsWereText) {
        try { args = JSON.parse(args); } catch { /* recorded as it came */ }
    }
    const record = { turn, name, args, argsWereText };
    if (name === 'openclaw_tool_call' || name === 'tool_call') {
        const target = /(?:^|[:/])(\w+)$/.exec(String(args?.id ?? ''))?.[1];
        if (target && toolNames.has(target)) Object.assign(record, { name: target, args: args.args ?? {}, via: name });
    }
    return record;
}

/** The tool results a request carries for the answer before it: the tool messages after its last assistant message. */
function toolResults(body) {
    const messages = body?.messages ?? [];
    let last = messages.length - 1;
    while (last >= 0 && messages[last].role !== 'assistant') last--;
    return messages.slice(last + 1).filter(m => m.role === 'tool').map(m => typeof m.content === 'string' ? m.content : JSON.stringify(m.content));
}

const ANSI = /\x1b\[[0-9;]*m/g;

/** OpenClaw's log line for a failed call, with the plugin's operator hint after the message: `[code -32602]`. */
const FAILURE_CODE = /\[tools\] (\w+) failed: (?:(?!\[tools\] )[^])*?\[code (-32\d{3})\]/g;

/**
 * The JSON-RPC code of each failed call of the plugin's, by tool name in lower case, in the order they failed: the
 * plugin gives it to OpenClaw's log alone (its tools.ts), what the model reads being the message.
 */
export function failureCodes(log) {
    const codes = new Map();
    for (const [, tool, code] of log.matchAll(FAILURE_CODE)) {
        const name = tool.toLowerCase();
        codes.set(name, [...(codes.get(name) ?? []), Number(code)]);
    }
    return codes;
}

/**
 * One task through OpenClaw. Returns the calls in the record's shape, the final answer and how the session ended,
 * plus the proxy's per-request figures and what the plugin's hooks logged.
 */
export async function runOpenClaw({ entry, prompt, provider = 'ollama', model, cwd, configFile, workspaceFiles = [], proxy, toolNames, instructionsLine, maxTurns, timeoutMs, thinking }) {
    proxy.log.length = 0;
    for (const file of workspaceFiles) fs.writeFileSync(path.join(cwd, file.name), file.text);
    // A short name: the run's state folder holds OpenClaw's copy of the plugin, node_modules and all, and a longer
    // path put its files past Windows' 260 characters (ENAMETOOLONG).
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skyrim-eval-'));
    // A state folder of the run's own: OpenClaw's temporary one fails to delete on Windows (a SQLite
    // file still open, EBUSY), and the run's answer is lost with it.
    const stateDir = path.join(dir, 'state');
    fs.mkdirSync(stateDir);
    const promptFile = path.join(dir, 'prompt.md');
    fs.writeFileSync(promptFile, prompt);
    const args = [
        entry, 'agent', 'exec', '--config', configFile, '--cwd', cwd, '--state-dir', stateDir,
        '--model', `${provider}/${model}`, '--message-file', promptFile, '--json',
        '--timeout', String(Math.ceil(timeoutMs / 1000)),
        ...(thinking ? ['--thinking', thinking] : [])
    ];
    const child = spawn(process.execPath, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', c => { stdout += c; });
    child.stderr.on('data', c => { stderr += c; });
    let overTurns = false;
    let timedOut = false;
    proxy.limit = maxTurns;
    proxy.onLimit = () => { overTurns = true; killTree(child); };
    // OpenClaw's own --timeout ends the run first; this is for a run that does not end.
    const timer = setTimeout(() => { timedOut = true; killTree(child); }, timeoutMs + 60_000);
    const exitCode = await new Promise(resolve => child.on('close', resolve));
    clearTimeout(timer);
    proxy.limit = Infinity;
    proxy.onLimit = null;
    try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); } catch { /* left in the temp folder */ }

    let envelope = null;
    try { envelope = JSON.parse(stdout.slice(stdout.indexOf('{'))); } catch { /* no envelope */ }

    const log = stderr.replace(ANSI, '');
    const codes = failureCodes(log);
    // The conversation's own requests carry the tool list; anything else is a side request.
    const main = proxy.log.filter(e => e.tools > 0 && !e.refused);
    const calls = [];
    main.forEach((request, turn) => {
        const results = toolResults(main[turn + 1]?.body);
        request.toolCalls.forEach((toolCall, i) => {
            const record = callRecord(toolCall, turn, toolNames);
            const text = results[i];
            if (text !== undefined) {
                // A failed call reads `[tool error] {"status": "error", "tool": "readrecord", "error": "'record' is required …"}`.
                record.isError = /^\s*\[tool error\]/.test(text);
                const code = record.isError && toolNames.has(record.name) ? codes.get(record.name.toLowerCase())?.shift() : undefined;
                if (code !== undefined) record.code = code;
                if (record.isError && /Tool \S+ not found|Unknown tool id/i.test(text)) record.unknownTool = true;
                if (NOT_ALLOWED.includes(record.name)) record.deployRefused = true;
                record.truncated = /\\*"status\\*"\s*:\s*\\*"truncated/.test(text);
                record.bytes = Buffer.byteLength(text);
                record.result = text.length > 600 ? `${text.slice(0, 600)}…` : text;
            }
            calls.push(record);
        });
    });

    const last = main.at(-1);
    const onlyCleanupFailed = envelope?.status === 'error' && /cleanup failed/i.test(envelope.error?.message ?? '');
    const stop = overTurns ? 'maxTurns'
        : timedOut || envelope?.status === 'timeout' ? 'timeout'
            : envelope?.status === 'ok' || (onlyCleanupFailed && last?.done && !last.toolCalls.length) ? 'answered'
                : `clientError:${envelope?.error?.kind ?? `exit ${exitCode}`}`;
    const turnStats = main.map(e => ({
        promptTokens: e.promptTokens ?? 0,
        newPromptTokens: (e.promptTokens ?? 0) - (e.cachedTokens ?? 0),
        outputTokens: e.outputTokens ?? 0,
        seconds: (e.ms ?? 0) / 1000,
        firstTokenSeconds: e.firstTokenMs === null ? null : e.firstTokenMs / 1000,
        thinkingChars: e.thinking.length,
        thinking: e.thinking,
        // What the model wrote beside its thinking, as the server passed it on: 13 failed runs of eval rounds 40–54 ended on a
        // turn with no call, six of them after thinking that planned an editRecord call, and at most ~130 tokens beside it.
        content: e.content.slice(0, 600),
        calls: e.toolCalls.length,
        doneReason: e.doneReason,
        cut: !e.done || e.abandoned || !!e.error
    }));
    const first = main[0];
    // The workspace files OpenClaw put into the prompt: those whose first line the system prompt holds.
    const system = (first?.body?.messages ?? []).filter(m => m.role === 'system').map(m => m.content ?? '').join('\n');
    const inPrompt = workspaceFiles.filter(file => {
        const heading = file.text.split('\n').find(line => line.trim());
        return heading && system.includes(heading.trim());
    }).map(file => file.name);
    return {
        calls,
        answer: envelope?.final || last?.content || '',
        stop,
        turnStats,
        client: {
            firstPrompt: first ? {
                tools: first.tools, toolsBytes: first.toolsBytes, systemChars: first.systemChars,
                toolSearch: first.toolNames.includes('tool_search'),
                pluginToolsListed: first.toolNames.filter(n => toolNames.has(n)).length,
                toolNames: first.toolNames,
                workspaceFilesInPrompt: inPrompt,
                // The plugin's prompt hook: its instructions at the end of the system prompt.
                instructionsInPrompt: !!instructionsLine && system.includes(instructionsLine),
                think: first.think, numCtx: first.numCtx, numPredict: first.numPredict, temperature: first.temperature
            } : null,
            sideRequests: proxy.log.filter(e => e.tools === 0 && e.model).map(e => ({ url: e.url, model: e.model, status: e.status, ms: e.ms })),
            cutAnswers: turnStats.filter(t => t.cut).length,
            // The plugin's build check: how often it asked for a build before the answer, and how often OpenClaw dropped
            // the pass it asked for — it never revises a run after a call it cannot replay, as any plugin tool's.
            buildCheckAsked: (log.match(/asked to build before answering/g) ?? []).length,
            buildCheckDropped: (log.match(/before_agent_finalize requested revision after potential side effects/g) ?? []).length,
            // Its text-call check: an answer that wrote a tool call as text, asked to make it (a dropped pass counts above).
            textCallAsked: (log.match(/asked to make the call it wrote as text/g) ?? []).length,
            toolSummary: envelope?.toolSummary ?? null,
            ...(stop.startsWith('clientError') ? { error: envelope?.error ?? null } : {}),
            stderr: log.split('\n')
                .filter(l => l.trim() && !/^\[(agent\/embedded|agents\/agent-command|state\/agent-db|plugins)\]/.test(l.trim()))
                // The core's own log lines, JSON over several lines.
                .filter(l => !/^\s*([{}\]]|"[^"]+"\s*:)/.test(l))
                .slice(0, 5)
        }
    };
}
