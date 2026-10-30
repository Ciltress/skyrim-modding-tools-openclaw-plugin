import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { callRecord, failureCodes, providerServer, startProxy, writeSessionConfig } from '../eval-openclaw.mjs';

/** The eval's copy of the user's OpenClaw configuration: theirs, changed only where a measurement needs it. */

let dir;
let root;
let projectsDir;
let workspace;

beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eval-openclaw-test-'));
    root = path.join(dir, 'plugin');
    projectsDir = path.join(dir, 'projects');
    workspace = path.join(dir, 'workspace-skyrim');
    for (const folder of [root, projectsDir, workspace]) fs.mkdirSync(folder);
    fs.writeFileSync(path.join(root, 'openclaw.plugin.json'), JSON.stringify({ id: 'skyrim-modding-tools' }));
    fs.writeFileSync(path.join(workspace, 'AGENTS.md'), '# AGENTS.md - Skyrim Modding\n');
});

afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

/** The user's configuration, shaped like the one the plugin runs in. */
function userConfig(change = config => config) {
    const elsewhere = path.join(dir, 'old-checkout');
    fs.mkdirSync(elsewhere, { recursive: true });
    fs.writeFileSync(path.join(elsewhere, 'openclaw.plugin.json'), JSON.stringify({ id: 'skyrim-modding-tools' }));
    return change({
        gateway: { auth: { token: 'secret' } },
        models: { providers: { ollama: { baseUrl: 'http://127.0.0.1:11434', models: [{ id: 'gemma4:e4b', contextTokens: 131072 }] } } },
        agents: {
            defaults: { model: 'ollama/swift', heartbeat: { agentId: 'swift' } },
            entries: {
                swift: { model: 'ollama/swift' },
                'skyrim-e4b': {
                    workspace, cwd: 'C:\\somewhere\\projects', model: { primary: 'ollama/gemma4:e4b', fallbacks: [] },
                    tools: { allow: ['read', 'write', 'skyrim-modding-tools', 'nodes', 'file_write'] }
                },
                'skyrim-swift': { workspace }
            }
        },
        mcp: { servers: { other: { command: 'x' } } },
        tools: { web: { fetch: { enabled: true } } },
        plugins: {
            load: { paths: [elsewhere, path.join(dir, 'another-plugin')] },
            entries: {
                'skyrim-modding-tools': {
                    enabled: true,
                    hooks: { allowConversationAccess: true },
                    config: { mo2Instance: 'G:\\Modding\\SkyrimSE-Test', projectsDir: 'C:\\somewhere\\projects', nexusApiKey: 'key', agents: ['skyrim-e4b', 'skyrim-swift'] }
                }
            }
        }
    });
}

function session(config, options = {}) {
    const configFile = path.join(dir, 'openclaw.json');
    fs.writeFileSync(configFile, JSON.stringify(config));
    const result = writeSessionConfig({
        dir, configFile, proxyUrl: 'http://127.0.0.1:5555', model: 'gemma4:e4b', root, projectsDir, profile: 'all', ...options
    });
    return { ...result, written: JSON.parse(fs.readFileSync(result.file, 'utf8')) };
}

describe('writeSessionConfig', () => {
    it('keeps the measured agent alone, working in the run\'s projects folder with its workspace files in the prompt', () => {
        const { written, agentId, workspaceFiles } = session(userConfig(), { agent: 'skyrim-e4b' });
        expect(agentId).toBe('skyrim-e4b');
        expect(Object.keys(written.agents.entries)).toEqual(['skyrim-e4b']);
        expect(written.agents.entries['skyrim-e4b']).toMatchObject({ workspace: projectsDir, cwd: projectsDir, contextInjection: 'always' });
        // What named a removed agent names the kept one, or OpenClaw refuses the configuration.
        expect(written.agents.defaults.heartbeat.agentId).toBe('skyrim-e4b');
        expect(workspaceFiles).toEqual([{ name: 'AGENTS.md', text: '# AGENTS.md - Skyrim Modding\n' }]);
        expect(written.gateway).toBeUndefined();
        expect(written.models.providers.ollama.baseUrl).toBe('http://127.0.0.1:5555');
    });

    it('takes the plugin\'s only modding agent when none is named, and asks when there are several', () => {
        const one = userConfig(config => { config.plugins.entries['skyrim-modding-tools'].config.agents = ['skyrim-e4b']; return config; });
        expect(session(one).agentId).toBe('skyrim-e4b');
        expect(() => session(userConfig())).toThrow(/skyrim-e4b, skyrim-swift.*--openclaw-agent/);
    });

    it('runs this checkout of the plugin on the run\'s projects folder, for the measured agent only', () => {
        const { written, pluginConfig } = session(userConfig(), { agent: 'skyrim-e4b' });
        const entry = written.plugins.entries['skyrim-modding-tools'];
        expect(entry.config).toEqual({
            mo2Instance: 'G:\\Modding\\SkyrimSE-Test', nexusApiKey: 'key', projectsDir, agents: ['skyrim-e4b'], profile: 'all'
        });
        expect(pluginConfig).toEqual(entry.config);
        expect(entry.hooks).toEqual({ allowConversationAccess: true });
        // Another checkout of the plugin is left out, other plugins stay.
        expect(written.plugins.load.paths).toEqual([path.join(dir, 'another-plugin'), root]);
        // The plugin's tools are the only Skyrim tools: no MCP server of the user's.
        expect(written.mcp.servers).toEqual({});
    });

    it('denies the shell, the device tools and the tools that change the instance, by their bare names', () => {
        const { written } = session(userConfig(), { agent: 'skyrim-e4b' });
        expect(written.tools.deny).toEqual(expect.arrayContaining([
            'exec', 'process', 'nodes', 'file_write', 'deployProject', 'installMod', 'downloadNexusFile', 'disableMod'
        ]));
        // Denied, they are no tool of the run: left allowed, OpenClaw warns of "unknown entries" on every run.
        expect(written.agents.entries['skyrim-e4b'].tools.allow).toEqual(['read', 'write', 'skyrim-modding-tools']);
    });

    it('learns nothing during a round: no skill_workshop, and self-learning off where the user has it on', () => {
        const learning = userConfig(config => {
            config.agents.entries['skyrim-e4b'].tools.allow.push('skill_workshop');
            config.skills = { workshop: { autonomous: { mode: 'auto' } } };
            return config;
        });
        const { written } = session(learning, { agent: 'skyrim-e4b' });
        expect(written.tools.deny).toContain('skill_workshop');
        expect(written.agents.entries['skyrim-e4b'].tools.allow).not.toContain('skill_workshop');
        expect(written.skills.workshop.autonomous.mode).toBe('off');
    });

    it('gives an unset tool profile the gateway\'s meaning, and keeps one the user set', () => {
        // agent exec would take `coding` for it, which leaves out every native plugin tool.
        expect(session(userConfig(), { agent: 'skyrim-e4b' }).written.tools.profile).toBe('full');
        const coding = userConfig(config => { config.tools.profile = 'coding'; return config; });
        expect(session(coding, { agent: 'skyrim-e4b' }).written.tools.profile).toBe('coding');
        const onAgent = userConfig(config => { config.agents.entries['skyrim-e4b'].tools.profile = 'minimal'; return config; });
        expect(session(onAgent, { agent: 'skyrim-e4b' }).written.tools.profile).toBeUndefined();
    });

    it('refuses a configuration that does not run the plugin', () => {
        const without = userConfig(config => { delete config.plugins.entries['skyrim-modding-tools']; return config; });
        expect(() => session(without, { agent: 'skyrim-e4b' })).toThrow(/skyrim-modding-tools/);
        const disabled = userConfig(config => { config.plugins.entries['skyrim-modding-tools'].enabled = false; return config; });
        expect(() => session(disabled, { agent: 'skyrim-e4b' })).toThrow(/enabled/);
    });

    it('configures the model under test, with another Ollama model\'s settings when it has no entry', () => {
        const { written, numCtx, copiedFrom } = session(userConfig(), { agent: 'skyrim-e4b', model: 'qwen:9b' });
        expect(copiedFrom).toBe('gemma4:e4b');
        expect(numCtx).toBe(131072);
        expect(written.agents.defaults.model).toEqual({ primary: 'ollama/qwen:9b' });
        expect(written.agents.entries['skyrim-e4b'].model).toEqual({ primary: 'ollama/qwen:9b', fallbacks: [] });
    });

    it('points an OpenAI provider at the proxy with its own path, and runs at the server\'s window', () => {
        const strata = userConfig(config => {
            config.models.providers.strata = {
                baseUrl: 'http://127.0.0.1:8080/v1', api: 'openai-completions',
                models: [{ id: 'coder', contextWindow: 131072, contextTokens: 92768 }]
            };
            config.agents.entries['skyrim-strata'] = { workspace, model: { primary: 'strata/coder', fallbacks: [] }, models: { 'strata/coder': {} } };
            return config;
        });
        const { written, numCtx } = session(strata, {
            agent: 'skyrim-strata', provider: 'strata', model: 'coder', proxyUrl: 'http://127.0.0.1:5555/v1'
        });
        expect(written.models.providers.strata.baseUrl).toBe('http://127.0.0.1:5555/v1');
        expect(written.models.providers.ollama.baseUrl).toBe('http://127.0.0.1:11434');
        expect(written.agents.entries['skyrim-strata'].model).toEqual({ primary: 'strata/coder', fallbacks: [] });
        expect(numCtx).toBe(131072);
        expect(() => session(userConfig(), { agent: 'skyrim-e4b', provider: 'strata' })).toThrow(/no provider 'strata'/);
    });
});

describe('providerServer', () => {
    it('takes Ollama at --ollama, and another provider\'s OpenAI server at its baseUrl', () => {
        const configFile = path.join(dir, 'openclaw.json');
        fs.writeFileSync(configFile, JSON.stringify({
            models: { providers: { strata: { api: 'openai-completions', baseUrl: 'http://127.0.0.1:8080/v1' }, other: { api: 'anthropic', baseUrl: 'x' } } }
        }));
        expect(providerServer(configFile, 'ollama', 'http://localhost:11434')).toEqual({ api: 'ollama', url: 'http://localhost:11434' });
        expect(providerServer(configFile, 'strata', 'unused')).toEqual({ api: 'openai-completions', url: 'http://127.0.0.1:8080/v1' });
        expect(() => providerServer(configFile, 'missing', 'unused')).toThrow(/no provider 'missing'.*strata, other/);
        expect(() => providerServer(configFile, 'other', 'unused')).toThrow(/openai-completions/);
    });
});

describe('startProxy', () => {
    /** An OpenAI server that streams one answer: thinking, a line of text, a tool call in pieces, then the usage. */
    async function openAiServer() {
        const events = [
            { choices: [{ delta: { role: 'assistant' } }] },
            { choices: [{ delta: { reasoning_content: 'Read it first.' } }] },
            { choices: [{ delta: { content: 'Reading.' } }] },
            { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'readRecord', arguments: '' } }] } }] },
            { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"record":' } }] } }] },
            { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"IronSword"}' } }] } }] },
            { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
            { choices: [], usage: { prompt_tokens: 900, completion_tokens: 40, prompt_tokens_details: { cached_tokens: 600 } } }
        ];
        const server = http.createServer((req, res) => {
            req.resume();
            req.on('end', () => {
                res.writeHead(200, { 'content-type': 'text/event-stream' });
                res.write(': keep-alive\n\n');
                for (const event of events) res.write(`data: ${JSON.stringify(event)}\n\n`);
                res.end('data: [DONE]\n\n');
            });
        });
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        return server;
    }

    it('reads an OpenAI stream: the thinking, the text, each tool call whole with its arguments parsed, the tokens', async () => {
        const server = await openAiServer();
        const proxy = await startProxy(`http://127.0.0.1:${server.address().port}/v1`, 'openai-completions');
        try {
            expect(proxy.baseUrl).toBe(`${proxy.url}/v1`);
            const response = await fetch(`${proxy.baseUrl}/chat/completions`, {
                method: 'POST',
                body: JSON.stringify({ model: 'coder', stream: true, reasoning_effort: 'high', max_tokens: 16384, tools: [{ function: { name: 'readRecord' } }], messages: [] })
            });
            await response.text();
            const [entry] = proxy.log;
            expect(entry).toMatchObject({
                url: '/v1/chat/completions', tools: 1, think: 'high', numPredict: 16384,
                done: true, doneReason: 'tool_calls', thinking: 'Read it first.', content: 'Reading.',
                promptTokens: 900, cachedTokens: 600, outputTokens: 40
            });
            expect(entry.toolCalls).toEqual([{ function: { name: 'readRecord', arguments: { record: 'IronSword' } } }]);
            expect(entry.firstTokenMs).not.toBeNull();
        } finally {
            proxy.close();
            server.close();
        }
    });
});

describe('callRecord', () => {
    const tools = new Set(['buildProject', 'editRecord']);

    it('records a plugin tool by its own name, and its arguments as they came', () => {
        expect(callRecord({ function: { name: 'editRecord', arguments: '{"project":"A"}' } }, 3, tools))
            .toEqual({ turn: 3, name: 'editRecord', args: { project: 'A' }, argsWereText: true });
    });

    it('records a call through Tool Search as the plugin tool it named', () => {
        const record = callRecord({ function: { name: 'openclaw_tool_call', arguments: { id: 'buildProject', args: { project: 'A' } } } }, 0, tools);
        expect(record).toMatchObject({ name: 'buildProject', args: { project: 'A' }, via: 'openclaw_tool_call' });
        expect(callRecord({ function: { name: 'tool_call', arguments: { id: 'memory_get' } } }, 0, tools).name).toBe('tool_call');
    });
});

describe('failureCodes', () => {
    it('reads each failed call\'s code from OpenClaw\'s log, by tool and in order, a message of several lines too', () => {
        const log = [
            '[tools] buildproject failed: Not built: C:\\Projects\\plugin\\Spells\\StormBolt.yaml [code -32602] params={"project":"StormBolt"}',
            '[tools] edit failed: Could not find the text params={"path":"a"}',
            '[tools] readrecord failed: No record\nnamed X [code -32603] params={}',
            '[tools] buildproject failed: Not built: 1 field(s) [code -32602] params={"project":"A"}'
        ].join('\n');
        expect(failureCodes(log)).toEqual(new Map([['buildproject', [-32602, -32602]], ['readrecord', [-32603]]]));
    });
});
