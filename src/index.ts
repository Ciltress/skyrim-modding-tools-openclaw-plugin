import { buildJsonPluginConfigSchema, definePluginEntry, type OpenClawPluginApi } from 'openclaw/plugin-sdk/plugin-entry';
import { createBackend, defaultProjectsDir, readConfiguration, stopBackends } from 'skyrim-modding-tools-core';
import { BuildCheck } from './buildCheck.js';
import { agentInstructions } from './instructions.js';
import { CONFIG_SCHEMA, PLUGIN_ID, PLUGIN_ROOT, pluginProduct, readSettings } from './settings.js';
import { SkyrimTools } from './tools.js';

/**
 * The plugin, registered into the gateway: the core's tools, a service that asks the backend once what it can
 * serve, the instructions for the modding agents, and the check that they build what they changed.
 */
export function registerSkyrimModdingTools(api: OpenClawPluginApi): SkyrimTools {
    // Where the plugin is installed, not the copy of it the gateway runs: projects/ and relative paths stay put.
    const settings = readSettings(api.pluginConfig, api.rootDir ?? PLUGIN_ROOT);
    const product = pluginProduct(settings.root);
    const backend = createBackend(settings.env, { product });
    const tools = new SkyrimTools(backend, product, settings.env);
    tools.register(api);

    // Only in the gateway: the CLI loads plugins too, to list or inspect them, and must not start a helper.
    // OpenClaw stops the service before a reload loads the next generation, which brings a helper of its own.
    if (api.registrationMode === 'full') {
        api.registerService({ id: PLUGIN_ID, start: () => { void tools.ensureGate(); }, stop: () => { stopBackends(); } });
    }

    const { paths } = readConfiguration(settings.env, { root: settings.root });
    const check = new BuildCheck(paths.SKYRIM_PROJECTS_DIR ?? defaultProjectsDir(settings.root), settings.agents);

    // The MCP server announces the core's instructions, which OpenClaw drops: here they reach the system prompt of
    // the agents that mod, at its cacheable end, with the plugin's own lines. Logged once per agent, so the gateway
    // log shows they do.
    const instructed = new Set<string>();
    api.on('before_prompt_build', (_event, context) => {
        if (!check.applies(context.agentId)) return undefined;
        if (!instructed.has(context.agentId!)) {
            instructed.add(context.agentId!);
            api.logger.info(`skyrim-modding-tools: instructions added to ${context.agentId}'s system prompt`);
        }
        return { appendSystemContext: agentInstructions(backend.describe()) };
    });
    api.on('after_tool_call', (event, context) => { check.afterToolCall(event, context); });
    api.on('before_agent_finalize', (event, context) => {
        const revision = check.beforeFinalize(context, event.runId ?? context.runId);
        if (revision) api.logger.info(`skyrim-modding-tools: ${context.agentId} asked to build before answering — ${revision.reason}`);
        return revision;
    });
    api.on('agent_end', (event, context) => { check.end(event.runId ?? context.runId); });
    return tools;
}

export default definePluginEntry({
    id: PLUGIN_ID,
    name: 'Skyrim Modding Tools',
    description:
        'Skyrim SE modding: records across a mod manager\'s load order, mods and patches authored as text and ' +
        'built into plugins, mods installed — the tools of skyrim-modding-tools-core under their own names.',
    configSchema: buildJsonPluginConfigSchema(CONFIG_SCHEMA as unknown as Parameters<typeof buildJsonPluginConfigSchema>[0]),
    register(api) {
        registerSkyrimModdingTools(api);
    }
});
