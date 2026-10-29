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
  settings.ts     the plugin's config: a field per core setting, with Settings' labels, sections and the secret
                  Nexus key; the agents that mod; projects in OpenClaw's state folder by default; its Product
  tools.ts        the core's tools as OpenClaw tools: names, direct-only, sequential, prepareArguments =
                  the core's coerceArgs, the MCP server's rules (profile, budget, gate, one retry, latch),
                  failures thrown as the core's message, the code for OpenClaw's log; healthcheck
  buildCheck.ts   after_tool_call / before_agent_finalize: a project changed and not built asks for a build
  writeGuard.ts   before_tool_call: a write or edit of a record file outside every project's plugin folder goes to its
                  path in the project (the call's params changed), or is stopped where the guard cannot place it;
                  a write over a numbered record file keeps the build's FormKey line
  textCalls.ts    before_agent_finalize: an answer that wrote a tool call as text is asked to make it; one that
                  announced a step, in a run with no call yet (buildCheck.ts knows), to take it
  manifest.ts     renders openclaw.plugin.json from the tools
  __tests__/      vitest, offline; the doubles are the core's (skyrim-modding-tools-core/testing)
scripts/
  link-openclaw.mjs   node_modules/openclaw -> the installed OpenClaw (types; the gateway supplies the SDK)
  copy-skills.mjs     the core's skills into skills/, in place (the gateway watches that folder)
  write-manifest.mjs  writes openclaw.plugin.json from dist/
  eval.mjs            the local-model eval: tasks, checks, the record of a round (npm run eval)
  eval-openclaw.mjs   its session: a copy of the user's OpenClaw config, a proxy before Ollama, `agent exec`
  eval-yaml.mjs       reads the record files a run leaves
  stage-clawhub.mjs   the ClawHub package: stage/ with the core bundled and its helper built, packed into out/
  __tests__/          vitest, plain JavaScript, for the eval's session and the staging
.github/workflows/
  ci.yml              tests and build, Windows and Linux, every push
  clawhub-release.yml by hand: Windows launcher, Linux pack, ClawHub's publish workflow (a preview by default)
openclaw.plugin.json  committed, generated: OpenClaw reads it before loading any code
THIRD_PARTY_NOTICES.md  the helper's libraries and their licenses; stage-clawhub.mjs refuses one it does not name
```

## Conventions that matter

- **OpenClaw is the host, not a dependency.** `.npmrc` keeps npm from installing it as a peer; the gateway
  supplies `openclaw/plugin-sdk/*` at runtime. Never add it to `dependencies`.
- **The manifest is generated.** After a tool changed in the core, `npm run build && npm run manifest`;
  `manifest.test.ts` fails on a stale one. A changed manifest needs `--accept-capabilities` on the next reload.
- **Nothing starts outside the gateway.** The CLI loads plugins too (`plugins inspect`, `skills list`); work that
  starts the helper runs only from a service, in `registrationMode: "full"`.
- **A tool fails by throwing** (OpenClaw's contract); the message is the core's, as plain text: OpenClaw writes it into
  its own JSON, so JSON in the message would be escaped twice — every backslash of a path four. The JSON-RPC code is
  OpenClaw's operator hint (`[code -32602]` in its `[tools] … failed:` log line, never the model's), which the eval reads.
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
If the helper's NuGet packages changed, name them in THIRD_PARTY_NOTICES.md, or the ClawHub release refuses them.

**The ClawHub package** (README, "Releasing on ClawHub") is staged, never this checkout: ClawHub installs with
`npm install --ignore-scripts`, which would leave a `github:` core without dist/ or helper. The staged package.json
names the core by its exact version and bundles it, without scripts, devDependencies or allowScripts. Check a staged
package with `clawhub package validate stage` and install it into a profile of its own, never the gateway's:
`openclaw --profile clawhub-test plugins install out/<tgz> --force --accept-capabilities`.

The gateway logs `skyrim-modding-tools: instructions added to <agent>'s system prompt` once per agent and every
build-check request, in `%TEMP%\openclaw\openclaw-<date>.log`.

A reload stops the service, and with it the old generation's helper; count `SkyrimHelper.exe` processes to check.
OpenClaw 2026.10.4 failed every other reload ("forced retirement after 5000ms: 1 still-running call(s)", its own
bug: an entry registering nothing did the same); 2026.10.7 reloads cleanly.

A changed config schema needs a gateway restart, not a reload: the running gateway checks the config against the
schema it loaded, refuses the new fields as invalid, and so refuses the reload that would bring the new schema.

Hook events name a tool in lower case (`editrecord`): compare names case-blind. The build check's extra pass never
happens in a run that called a plugin tool or wrote a file — OpenClaw revises only runs it could replay — so the
check only logs its request (buildCheck.ts).

## The eval

```bash
npm run build
npm run eval -- --openclaw-agent skyrim-e4b --runs 1 --authoring-runs 5 --detailed
```

It runs each task through `openclaw agent exec` on a copy of the user's OpenClaw config (eval-openclaw.mjs says
what it changes), with this checkout's `dist/`, and prints the entry for `docs/research/local-model-evals.md`
beside the repositories, where every round is recorded. The output is a local model's: read the transcripts for
what the tools or their answers could do better. `agent exec` loads plugins in registrationMode `discovery` (tools
and hooks run, the service does not; the helper ends with the run) and takes the `coding` tool profile where the
config sets none, which hides every native plugin tool — the session config sets `full`, what an unset profile is
in the gateway. The config copy holds the Nexus key: it lives in a temp folder of its own, deleted at the end.

## Care with a real backend

The tools write into a mod manager's instance. Work on a test instance; change other people's mods only through
patches; ask before deploying into a profile someone plays.
