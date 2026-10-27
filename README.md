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
- **A write guard:** an agent's write or edit of a record file that would land in the projects folder outside every
  project's plugin folder, where no build reads it, goes to the file's path in its project instead, and the answer
  names that path. Where the project or the group folder cannot be told, it is stopped, with where the file goes.
- **A text-call check:** an answer that wrote a tool call as text, which runs nothing, is asked to make the call.

## Install

### From ClawHub

Needs OpenClaw 2026.10.7 or later and the .NET 10 runtime for the plugin helper: on Windows its installer from
[dotnet.microsoft.com](https://dotnet.microsoft.com/download/dotnet/10.0), on Linux your distribution's package
(`dotnet-runtime` on Arch and CachyOS). Windows and Linux on x64 only.

```bash
openclaw plugins install clawhub:skyrim-modding-tools
```

The package brings the core and its helper, built.

### From source

Needs OpenClaw 2026.10.7 or later (on Node.js 24.22.1) and the .NET 10 SDK for the plugin helper.

```bash
git clone https://github.com/Ciltress/skyrim-modding-tools-openclaw-plugin
cd skyrim-modding-tools-openclaw-plugin
npm install
npm run build
npm run build:helper
openclaw plugins install -l .
```

### Settings

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
SecretRef. A path may start with `~`; a relative one is the plugin's folder's. Without `projectsDir` the projects
are in `skyrim-modding-tools/projects` in OpenClaw's state folder (`~/.openclaw`, or the profile's), which an update
of the plugin leaves alone.

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

### Releasing on ClawHub

ClawHub installs a package with `npm install --ignore-scripts`, so the package carries the core, bundled, with its
helper built for both systems: `npm run stage:clawhub` lays it out in `stage/` and packs it into `out/`. The
*ClawHub release* workflow (Actions tab, run by hand) builds `SkyrimHelper.exe` on Windows, packs on Linux, where
the Linux launcher keeps its executable bit, and hands the package to ClawHub's publish workflow: a preview while
*dry_run* is ticked.

The first release is published by hand, which creates the package on ClawHub: run the workflow as a preview,
download its `clawhub-package` artifact, then

```bash
npx clawhub login
npx clawhub package publish ./skyrim-modding-tools-<version>.tgz
npx clawhub package trusted-publisher set skyrim-modding-tools \
  --repository Ciltress/skyrim-modding-tools-openclaw-plugin --workflow-filename clawhub-release.yml
```

From then on: raise `version` in package.json, push, and run the workflow with *dry_run* unticked.
`npx clawhub package moderation-status skyrim-modding-tools` shows the review of the latest release.

## License

GPL-3.0-only, as the core. The ClawHub package also ships the helper's libraries, each under its own license:
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
