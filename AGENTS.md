# AGENTS.md

Guidance for AI agents working **on this repository**: the OpenClaw plugin that serves the Skyrim modding tools.

## What this is

A native OpenClaw plugin, `skyrim-modding-tools`. The tools are not here: they are
[skyrim-modding-tools-core](https://github.com/Ciltress/skyrim-modding-tools-core)'s, installed from a tag of its
GitHub repository. **Core-first:** a change to a tool, an answer, a guide or a skill is made in the core, never
only here; this repository holds OpenClaw's glue. What only OpenClaw can do — a hook — stays here, and the MCP
server gets the nearest equivalent where one exists (the core's ADR-0009).

## Layout

```
src/
  index.ts        the entry: definePluginEntry, the gate service, the hooks
  settings.ts     the plugin's config (envFile, env, agents) and its Product for the core
  tools.ts        the core's tools as OpenClaw tools: names, direct-only, sequential, prepareArguments =
                  the core's coerceArgs, the MCP server's rules (profile, budget, gate, one retry, latch),
                  failures thrown as the MCP server's error JSON; healthcheck
  buildCheck.ts   after_tool_call / before_agent_finalize: a project changed and not built asks for a build
  manifest.ts     renders openclaw.plugin.json from the tools
  __tests__/      vitest, offline; the doubles are the core's (skyrim-modding-tools-core/testing)
scripts/
  link-openclaw.mjs   node_modules/openclaw -> the installed OpenClaw (types; the gateway supplies the SDK)
  copy-skills.mjs     the core's skills into skills/, in place (the gateway watches that folder)
  write-manifest.mjs  writes openclaw.plugin.json from dist/
openclaw.plugin.json  committed, generated: OpenClaw reads it before loading any code
```

## Conventions that matter

- **OpenClaw is the host, not a dependency.** `.npmrc` keeps npm from installing it as a peer; the gateway
  supplies `openclaw/plugin-sdk/*` at runtime. Never add it to `dependencies`.
- **The manifest is generated.** After a tool changed in the core, `npm run build && npm run manifest`;
  `manifest.test.ts` fails on a stale one. A changed manifest needs `--accept-capabilities` on the next reload.
- **Nothing starts outside the gateway.** The CLI loads plugins too (`plugins inspect`, `skills list`); work that
  starts the helper runs only from a service, in `registrationMode: "full"`.
- **A tool fails by throwing** (OpenClaw's contract); the message is the MCP server's `{"error", "code"}` JSON.
  Nothing goes into `details` that OpenClaw would grade: a `status` there that is not a success fails the call.
- **Skills come from the core.** Never edit `skills/`; it is rebuilt from `node_modules/skyrim-modding-tools-core`.
  The manifest names `skills/Domain/skills`, the folder whose children are the skills; OpenClaw links them into
  its `plugin-skills` when the gateway starts.

## Working on this repo

```bash
npm install && npm run build && npm test
npm run build:helper && npm run check:helper
openclaw plugins reload skyrim-modding-tools --accept-capabilities
```

A new core release: `npm install "skyrim-modding-tools-core@git+https://github.com/Ciltress/skyrim-modding-tools-core.git#vX.Y.Z"`,
`npm approve-scripts skyrim-modding-tools-core`, drop the old pin from `allowScripts`, build, rebuild the helper.

The gateway logs `skyrim-modding-tools: instructions added to <agent>'s system prompt` once per agent and every
build-check request, in `%TEMP%\openclaw\openclaw-<date>.log`.

A reload stops the service, and with it the old generation's helper; count `SkyrimHelper.exe` processes to check.
On OpenClaw 2026.10.4 every other reload fails with "forced retirement after 5000ms: 1 still-running call(s)"
(with or without the service's stop, no tool call running); the next reload succeeds.

## Care with a real backend

The tools write into a mod manager's instance. Work on a test instance; change other people's mods only through
patches; ask before deploying into a profile someone plays.
