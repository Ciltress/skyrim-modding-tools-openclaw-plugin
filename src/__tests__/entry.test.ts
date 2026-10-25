import type { OpenClawPluginApi } from 'openclaw/plugin-sdk/plugin-entry';
import { stopBackends } from 'skyrim-modding-tools-core';
import { registerSkyrimModdingTools } from '../index.js';
import { agentInstructions } from '../instructions.js';

/** The plugin as the gateway registers it: what starts, and what stops before the next generation loads. */

vi.mock('skyrim-modding-tools-core', async original => ({
    ...(await original<typeof import('skyrim-modding-tools-core')>()),
    stopBackends: vi.fn()
}));

type Service = Parameters<OpenClawPluginApi['registerService']>[0];

/** A plugin API that keeps the services and hooks registered and ignores the rest. */
function entryApi(registrationMode: OpenClawPluginApi['registrationMode'], pluginConfig?: Record<string, unknown>) {
    const services: Service[] = [];
    const hooks = new Map<string, (event: unknown, context: unknown) => unknown>();
    const api = {
        registrationMode,
        pluginConfig,
        registerTool: () => { },
        registerService: (service: Service) => { services.push(service); },
        on: (name: string, handler: (event: unknown, context: unknown) => unknown) => { hooks.set(name, handler); },
        logger: { info: () => { } }
    };
    return { api: api as unknown as OpenClawPluginApi, services, hooks };
}

describe('the plugin in the gateway', () => {
    it('stops the helper when OpenClaw stops its service, so a reload leaves none behind', async () => {
        const { api, services } = entryApi('full');
        registerSkyrimModdingTools(api);
        expect(services.map(service => service.id)).toEqual(['skyrim-modding-tools']);

        await services[0].stop?.({} as never);
        expect(stopBackends).toHaveBeenCalledOnce();
    });

    it('registers no service where the CLI loads it, so nothing starts a helper there', () => {
        const { api, services } = entryApi('discovery');
        registerSkyrimModdingTools(api);
        expect(services).toEqual([]);
    });

    it('puts the instructions into the system prompt of the agents that mod, and of no other', () => {
        const { api, hooks } = entryApi('full', { agents: ['skyrim-e4b'] });
        const tools = registerSkyrimModdingTools(api);
        const prompt = (agentId: string) => hooks.get('before_prompt_build')!({}, { agentId });
        expect(prompt('skyrim-e4b')).toEqual({ appendSystemContext: agentInstructions(tools.backend.describe()) });
        expect(prompt('swift')).toBeUndefined();
    });
});
