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

/** A plugin API that keeps the services, hooks, CLI commands and warnings registered and ignores the rest. */
function entryApi(registrationMode: OpenClawPluginApi['registrationMode'], pluginConfig?: Record<string, unknown>) {
    const services: Service[] = [];
    const hooks = new Map<string, (event: unknown, context: unknown) => unknown>();
    const commands: string[] = [];
    const warnings: string[] = [];
    const api = {
        registrationMode,
        pluginConfig,
        registerTool: () => { },
        registerService: (service: Service) => { services.push(service); },
        registerCli: (_registrar: unknown, options: { descriptors: { name: string }[] }) => {
            commands.push(...options.descriptors.map(descriptor => descriptor.name));
        },
        on: (name: string, handler: (event: unknown, context: unknown) => unknown) => { hooks.set(name, handler); },
        logger: { info: () => { }, warn: (message: string) => { warnings.push(message); } }
    };
    return { api: api as unknown as OpenClawPluginApi, services, hooks, commands, warnings };
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

    it('offers openclaw skyrim setup where the CLI of OpenClaw collects its commands', () => {
        const { api, commands } = entryApi('cli-metadata');
        registerSkyrimModdingTools(api);
        expect(commands).toEqual(['skyrim']);
    });

    it('says in the gateway log how to set it up, while no agent mods with it, as after an install from ClawHub', () => {
        const fresh = entryApi('full');
        registerSkyrimModdingTools(fresh.api);
        expect(fresh.warnings).toEqual([expect.stringContaining('openclaw skyrim setup')]);

        const set = entryApi('full', { agents: ['muddy'] });
        registerSkyrimModdingTools(set.api);
        expect(set.warnings).toEqual([]);
    });

    it('puts the instructions into the system prompt of the agents that mod, and of no other', () => {
        const { api, hooks } = entryApi('full', { agents: ['skyrim-e4b'] });
        const tools = registerSkyrimModdingTools(api);
        const prompt = (agentId: string) => hooks.get('before_prompt_build')!({}, { agentId });
        expect(prompt('skyrim-e4b')).toEqual({ appendSystemContext: agentInstructions(tools.backend.describe()) });
        expect(prompt('swift')).toBeUndefined();
    });
});
