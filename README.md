# skyrim-modding-tools-openclaw-plugin

The Skyrim Special Edition modding tools as a native [OpenClaw](https://openclaw.ai) plugin: look records up
across a Mod Organizer or Amethyst load order, author mods and patches as text projects, build them into plugins
and deploy them, install downloaded mods. The tools are
[skyrim-modding-tools-core](https://github.com/Ciltress/skyrim-modding-tools-core)'s; the
[MCP server](https://github.com/Ciltress/skyrim-modding-tools-mcp) serves the same tools to any MCP client.

What the plugin does that an MCP server cannot in OpenClaw:

- **Tools under their own names** — `editRecord`, not `skyrim__editRecord` — kept outside Tool Search, so a
  small local model sees them without searching.
- **The instructions** the MCP server announces, which OpenClaw drops, in the system prompt of the agents that mod.
- **The skills** ship with the plugin; no `skills.load.extraDirs`.
- **A build check:** an agent that changed a project and did not build it is asked once more before it answers.

## Install

Needs OpenClaw 2026.10.4 or later (2026.10.7 recommended; it needs Node.js 24.22.1) and the .NET 10 SDK for the
plugin helper.

```bash
git clone https://github.com/Ciltress/skyrim-modding-tools-openclaw-plugin
cd skyrim-modding-tools-openclaw-plugin
npm install
npm run build
npm run build:helper
openclaw plugins install -l .
```

Then set it up in OpenClaw's Settings page — *Plugins → Skyrim Modding Tools*: the Mod Organizer instance (or
Amethyst), the projects folder, the agents that mod, a Nexus Mods API key if you want the Nexus tools — or in
`~/.openclaw/openclaw.json`:

```json5
{
  plugins: {
    entries: {
      "skyrim-modding-tools": {
        enabled: true,
        // The instructions and the build check are conversation hooks.
        hooks: { allowConversationAccess: true },
        config: {
          mo2Instance: "G:/Modding/SkyrimSE-Test",
          projectsDir: "C:/Users/you/skyrim-projects",
          nexusApiKey: "<your key>",
          // The agents that mod.
          agents: ["skyrim"]
        }
      }
    }
  },
  agents: {
    entries: {
      skyrim: {
        cwd: "C:/Users/you/skyrim-projects",
        tools: { allow: ["read", "write", "edit", "skills_read", "skyrim-modding-tools"] }
      }
    }
  }
}
```

The tools are optional: an agent gets them only when its `tools.allow` names the plugin (or a tool). Every field
is listed in Settings with what it does; the rarer ones — the Creation Kit and Papyrus compiler, Amethyst's folder,
a Wine prefix, the tool profile — are under *advanced*. Settings shows the Nexus key hidden, and it may be a
SecretRef. A path may start with `~`; a relative one is the plugin's folder's, and without `projectsDir` the
projects are in `projects/` there.

## Development

```bash
npm install            # links the installed OpenClaw for its SDK's types
npm run build          # tsc -> dist/, and the core's skills into skills/
npm test
npm run manifest       # after a tool changed in the core: rewrite openclaw.plugin.json
npm run build:helper   # the core's helper, in node_modules/skyrim-modding-tools-core
openclaw plugins reload skyrim-modding-tools --accept-capabilities
```

See [AGENTS.md](AGENTS.md).

## License

GPL-3.0-only, as the core.
