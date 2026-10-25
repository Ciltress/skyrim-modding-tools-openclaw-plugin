import type { OpenClawPluginApi } from 'openclaw/plugin-sdk/plugin-entry';
import { stopBackends } from 'skyrim-modding-tools-core';
import { registerSkyrimModdingTools } from '../index.js';

/** The plugin as the gateway registers it: what starts, and what stops before the next generation loads. */

vi.mock('skyrim-modding-tools-core', async original => ({
    ...(await original<typeof import('skyrim-modding-tools-core')>()),
    stopBackends: vi.fn()
}));

type Service = Parameters<OpenClawPluginApi['registerService']>[0];

/** A plugin API that keeps the services registered and ignores the rest. */
function entryApi(registrationMode: OpenClawPluginApi['registrationMode']) {
    const services: Service[] = [];
    const api = {
        registrationMode,
        pluginConfig: undefined,
        registerTool: () => { },
        registerService: (service: Service) => { services.push(service); },
        on: () => { },
        logger: { info: () => { } }
    };
    return { api: api as unknown as OpenClawPluginApi, services };
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
});
