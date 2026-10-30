import { PermanentBackendError, SessionExpiredError, ToolError, ToolErrorCode, createHandlers, type AppBackend } from 'skyrim-modding-tools-core';
import { fakeBackend } from 'skyrim-modding-tools-core/testing';
import { pluginProduct } from '../settings.js';
import { SkyrimTools, failure, failureText, type ToolApi } from '../tools.js';

/**
 * The core's tools as OpenClaw tools: the names, what OpenClaw is told about each, what a call answers, and the
 * MCP server's rules kept — profile, gate, budget, the one retry, the latch.
 */

const product = pluginProduct(process.cwd());

/** A plugin API that keeps what is registered, with each factory as OpenClaw would call it. */
function recordingApi() {
    const registered: { name?: string; optional?: boolean; factory: () => unknown }[] = [];
    const api: ToolApi = {
        registerTool: ((tool: unknown, options?: { name?: string; optional?: boolean }) => {
            registered.push({ name: options?.name, optional: options?.optional, factory: tool as () => unknown });
        }) as ToolApi['registerTool']
    };
    const tool = (name: string) => registered.find(entry => entry.name === name)!.factory() as any;
    return { api, registered, tool };
}

function plugin(env: NodeJS.ProcessEnv = {}, options: Parameters<typeof fakeBackend>[0] = {}) {
    const fake = fakeBackend(options);
    const tools = new SkyrimTools(fake.backend as unknown as AppBackend, product, { MCP_GATE: 'off', ...env });
    const { api, registered, tool } = recordingApi();
    tools.register(api);
    return { tools, fake, registered, tool };
}

describe('the tools as OpenClaw registers them', () => {
    it('registers every core tool under its own name, healthcheck last, each optional', () => {
        const { registered } = plugin();
        const core = createHandlers(undefined as unknown as AppBackend, product).flatMap(h => h.getTools()).map(t => t.name);
        expect(registered.map(entry => entry.name)).toEqual([...core, 'healthcheck']);
        expect(registered.every(entry => entry.optional === true)).toBe(true);
    });

    it('keeps each tool outside Tool Search, one call at a time, with the core\'s schema and description', () => {
        const { tool } = plugin();
        const definition = createHandlers(undefined as unknown as AppBackend, product)
            .flatMap(h => h.getTools()).find(t => t.name === 'editRecord')!;
        const editRecord = tool('editRecord');
        expect(editRecord.name).toBe('editRecord');
        expect(editRecord.catalogMode).toBe('direct-only');
        expect(editRecord.executionMode).toBe('sequential');
        expect(editRecord.parameters).toEqual(definition.inputSchema);
        expect(editRecord.description).toBe(definition.description);
        expect(editRecord.label).toBe(definition.annotations!.title);
    });

    it('repairs arguments before OpenClaw checks them, as the core does: a list sent as JSON text', () => {
        const { tool } = plugin();
        expect(tool('findRecords').prepareArguments({ query: 'Iron', types: '["Weapon"]' }))
            .toEqual({ query: 'Iron', types: ['Weapon'] });
    });

    it('lists only the profile\'s tools', () => {
        const { registered } = plugin({ MCP_PROFILE: 'readonly' });
        const names = registered.map(entry => entry.name);
        expect(names).toContain('readRecord');
        expect(names).not.toContain('buildProject');
        expect(names.at(-1)).toBe('healthcheck');
    });
});

describe('a call', () => {
    it('answers the text the MCP server answers, connecting first', async () => {
        const { tool, fake } = plugin();
        const result = await tool('readSkill').execute('call-1', {});
        expect(fake.connects()).toBe(1);
        expect(JSON.parse(result.content[0].text)).toMatchObject({ status: 'success', skillCount: 7 });
        // Nothing in details for OpenClaw to grade: a `status` there that is not a success fails the call.
        expect(result.details).toEqual({});
    });

    it('fails with the core\'s message as plain text, its code for OpenClaw\'s log alone', async () => {
        const { tool } = plugin();
        const error = await tool('readRecord').execute('call-2', {}).catch((e: Error) => e);
        expect(error.message).toMatch(/^'record' is required/);
        expect(error.message).not.toMatch(/MCP error|"code"|-32602/);
        expect(Object.getOwnPropertyDescriptor(error, Symbol.for('openclaw.toolOperatorHint'))?.value).toBe('[code -32602]');
    });

    it('fails with a path\'s backslashes as the core wrote them, for OpenClaw\'s JSON to escape once', async () => {
        const { tool } = plugin({}, { failWith: { error: new ToolError(ToolErrorCode.InvalidParams, 'Not built: C:\\Projects\\plugin\\Spells\\StormBolt.yaml'), times: 1 } });
        const error = await tool('findRecords').execute('call-4', { query: 'Iron' }).catch((e: Error) => e);
        expect(error.message).toBe('Not built: C:\\Projects\\plugin\\Spells\\StormBolt.yaml');
    });

    it('retries a call the backend refused for an expired session, once', async () => {
        const { tool, fake } = plugin({}, { failWith: { error: new SessionExpiredError('stale'), times: 1 } });
        const result = await tool('findRecords').execute('call-3', { query: 'Iron' });
        expect(JSON.parse(result.content[0].text).status).toBe('success');
        expect(fake.connects()).toBe(2);
    });

    it('never connects again after the backend refused the credential', async () => {
        const { tool, fake } = plugin({}, { connectError: new PermanentBackendError('refused') });
        await expect(tool('findRecords').execute('a', { query: 'x' })).rejects.toThrow(/refused/);
        await expect(tool('findRecords').execute('b', { query: 'x' })).rejects.toThrow(/refused/);
        expect(fake.connects()).toBe(1);
    });

    it('withholds what the backend cannot serve, from the next tool list and from a call', async () => {
        // A backend that says what it has, and Nexus is not among it. An empty answer gates nothing, as the core's
        // evaluateGate decides: it cannot tell "nothing" from "cannot say".
        const { tool, tools, registered } = plugin({ MCP_GATE: 'on' }, { capabilities: async () => ['projects'] });
        await tools.ensureGate();
        const nexus = registered.find(entry => entry.name === 'searchNexus')!;
        expect(nexus.factory()).toBeNull();
        expect(tool('findRecords')).not.toBeNull();
        await expect(tools.call('searchNexus', { query: 'x' })).rejects.toMatchObject({ code: -32600 });
    });

    it('cuts an answer over the budget into the core\'s valid JSON naming the next step', async () => {
        const { tool } = plugin({ MCP_MAX_RESPONSE_BYTES: '200' });
        const answer = JSON.parse((await tool('readSkill').execute('c', { skill: 'skyrim-modding-basics' })).content[0].text);
        expect(answer.status).toBe('truncated');
    });

    it('answers healthcheck without the backend, saying what it is bound to', async () => {
        const { tool, fake } = plugin();
        const answer = JSON.parse((await tool('healthcheck').execute('h', {})).content[0].text);
        expect(answer).toMatchObject({ status: 'healthy', boundTo: 'the fake Mod Organizer instance', tools: { profile: 'all' } });
        expect(fake.connects()).toBe(0);
    });
});

describe('failure', () => {
    it('is internal for anything that is not a ToolError, keeping the message', () => {
        const failed = failure(new Error('disk full'));
        expect(failed.message).toBe('disk full');
        expect(failureText(new Error('disk full'))).toBe('disk full');
        expect(Object.getOwnPropertyDescriptor(failed, Symbol.for('openclaw.toolOperatorHint'))?.value).toBe('[code -32603]');
    });
});
