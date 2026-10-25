import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { callRecord, failureCodes, writeSessionConfig } from '../eval-openclaw.mjs';

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
