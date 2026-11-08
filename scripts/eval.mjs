#!/usr/bin/env node
/**
 * Measures how well a local model drives this plugin through OpenClaw: a fixed set of modding tasks, each run through
 * OpenClaw itself, headless (`openclaw agent exec`), with the model served by Ollama behind a logging proxy
 * (scripts/eval-openclaw.mjs) — what a user of OpenClaw with a local model gets, on their own OpenClaw configuration
 * and agent: its system prompt with the plugin's instructions, its tools, Tool Search, its thinking level and context.
 *
 *   npm run build
 *   node scripts/eval.mjs --openclaw-agent <agent> [--model <model>] [--profile all] [--runs 3]
 *                         [--authoring-runs 5] [--tasks find,read] [--max-turns 25] [--think true|false|<level>]
 *                         [--detailed] [--out <file>] [--ollama http://localhost:11434] [--settle 60]
 *                         [--provider ollama|<provider>] [--openclaw <openclaw.mjs>] [--openclaw-config <openclaw.json>]
 *                         [--all-plugins] [--blender] [--group coverage]
 *
 * The agent is --openclaw-agent, else the plugin's only modding agent, else the configuration's only agent.
 * --group coverage runs the coverage tasks (scripts/eval-coverage.mjs: every other kind of record a mod makes, the
 * navmesh among them) and the LOOT task instead of the main set; --tasks names any task of either.
 * A run loads this plugin and its provider's alone (`plugins.allow`): with all of the configuration's, OpenClaw's start
 * was 119 of round 128's 231 minutes. --all-plugins loads every plugin the configuration has, as the user's gateway does.
 * --provider names the model's provider in OpenClaw's configuration: `ollama` (the default) is Ollama at --ollama;
 * another is a server with OpenAI's API, an `openai-completions` provider (--provider <its id> --model <the model id
 * it serves>), proxied at its baseUrl. Such a server holds its context and model itself: the warm-up
 * loads nothing, and the speed is the server's own timings, when it gives them.
 * --authoring-runs sets the runs of the tasks that write records (sword, armor, potion, recipe, arrow, shout, effect,
 * leveled, world, outdoor, perk, quest, dialogue, setting, keyword, conflict, spell, npc, note, and their `+detailed` runs,
 * and the crash and Papyrus logs read), --runs those of the others; it defaults
 * to --runs. Every miss of rounds 24–31 was an authoring task's, and with three runs each a round's noise was about ±3
 * of 39. --think true|false|<level> passes a thinking level for the
 * run (true is OpenClaw's `medium`, false `off`); unset, the agent's own.
 *
 * Before the first task the model is loaded with a short "hi", so no task's time includes the load; when it was not
 * loaded yet (a switch from another model), --settle seconds pass before the tasks.
 *
 * --detailed runs each authoring task again as `<task>+detailed`, with a prompt that spells out what a player who
 * knows the game would ask for — stats, the vanilla thing it is like, the level — but no editor IDs; the checks stay
 * the same, so the two compare. sword+detailed is held, beside them, to the enchantment its prompt names: a new record
 * of the project, Flame Blade Burn, of 10 points (since round 78); and to the sword's value of 150 and charge of 500
 * (since round 88). A task that builds is built when a build succeeded after the run's last change, the delivery rule
 * the tools give the model (since round 100; until then any build that succeeded). The sword and the note are drawn by
 * the game: their model a mesh it has (since round 106); the sword in the player's hands in first person too, its
 * FirstPersonModel named (since round 107). The armor task (since round 125) asks for a helmet that protects from frost:
 * worn on the head, drawn on the ground and on its wearer — its own model and an armor addon's the game has — with a frost
 * resistance cast for as long as it is worn; armor+detailed beside that for heavy armor, an armor rating of 20, a weight
 * of 6, a value of 200, and a new enchantment of the project, Frostguard Ward, of 30. Since round 125 too: a potion that
 * restores health (+detailed: 40 at once, value 30, weight 0.5), a recipe for the Ancient Nord Sword at the forge
 * (2 iron ingots and a leather strip; +detailed: steel ingots, and the Steel Smithing perk) and arrows that beat the
 * Steel Arrow's damage, flying as a projectile the game draws (+detailed: 16 damage, value 4); a dragon shout of three
 * words, each casting a voice spell that deals shock damage (+detailed: its own words Kreh, Dahl and Vund, translated,
 * dealing 20, 40 and 60, recovering in 15, 30 and 45 s); and a spell with a magic effect of the mod's own, not the game's,
 * that raises the caster's carry weight and gives it back when it ends (+detailed: named Feather Step, 100 for 60 s).
 * And, the user's picks of the objects no task covered: a bandit leveled list that also gives the Silver Sword, its
 * own entries kept (+detailed: at level 1, a one-handed list); a chest in Breezehome holding 500 gold and a Steel Sword
 * (+detailed: its own, Hunter's Chest, that never respawns, with 10 Steel Arrows too); a perk by which bows deal 20%
 * more damage (+detailed: 30%, while sneaking, Archery 30 required); and a quest started with the game whose compiled
 * script gives the player 500 gold (+detailed: named Starter Gold, run once, a Steel Sword too, the quest stopped).
 * Since round 133: a chest holding 100 gold placed outdoors in Riverwood beside the grindstone at Alvor's smithy, in the
 * exterior cell its position lies in, on the ground there (+detailed: its own, Smith's Chest, that never respawns, with 5 Iron
 * Ingots too); and, with --blender alone, Whiterun Stables' strongbox moved 100 units east in Blender and a copy placed 64
 * north of it, through Blender's MCP server and brought back with importCell (+detailed: both turned a quarter turn). A run
 * with --blender keeps OpenClaw's Blender MCP server, its tools the measured agent's, and gives it the Blender to start.
 *
 * --check <folder> runs no model: the checks alone, on projects folders made by hand, one per folder named
 * `<task>[+detailed]--<what it is>` — a correct mod, which passes every check, or one broken on purpose, which fails the
 * check its fault is for (checkCases).
 *
 * Nothing is deployed and nothing is installed: the tools that would are denied. The plugin's projects folder is a
 * temporary one, emptied before each run; the instance is only read.
 *
 * Every task is checked against the instance itself: the expected FormIDs and values are read through the plugin's
 * tools at startup — the built ones, on the instance the user's configuration gives the plugin — not written into
 * this file. The full record — every call, its arguments and what came back — goes to --out as JSON; a summary is
 * printed, with the entry for the log of every round, docs/research/local-model-evals.md beside the repositories
 * (also saved beside the JSON as .md). After the tasks it measures the model's prompt and generation speed at the
 * same context, for that entry.
 *
 * The session's copy of OpenClaw's configuration holds the plugin's Nexus key: it is written into a folder of the
 * temp folder's own and deleted at the end, Ctrl+C included, and never printed.
 *
 * Until round 63 the eval was the MCP server's (skyrim-modding-tools-mcp, scripts/eval-ollama.mjs), with OpenClaw
 * running that server; its own Ollama client is not ported.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { collectToolFamilies, createBackend, renderToolReference, stopBackends } from 'skyrim-modding-tools-core';
import {
    builtAfterLastChange, dealtDamage, firstPersonModelOf, levelFollowsPlayer, modelOf, NOT_ALLOWED, openClawConfigFile, openClawEntry, openClawVersion,
    overridesIn, providerServer, runOpenClaw, startProxy, writeSessionConfig
} from './eval-openclaw.mjs';
import { coverageTasks } from './eval-coverage.mjs';
import { leftEscape, lineShape, scalarValue, textValue, translatedValue } from './eval-yaml.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const { values: opt } = parseArgs({
    options: {
        model: { type: 'string', default: 'gemma4:e4b' },
        profile: { type: 'string', default: 'all' },
        runs: { type: 'string', default: '3' },
        'authoring-runs': { type: 'string' },
        tasks: { type: 'string' },
        group: { type: 'string' },
        'max-turns': { type: 'string', default: '25' },
        settle: { type: 'string', default: '60' },
        think: { type: 'string' },
        out: { type: 'string' },
        detailed: { type: 'boolean', default: false },
        ollama: { type: 'string', default: process.env.OLLAMA_HOST || 'localhost' },
        provider: { type: 'string', default: 'ollama' },
        openclaw: { type: 'string' },
        'openclaw-config': { type: 'string' },
        'openclaw-agent': { type: 'string' },
        'all-plugins': { type: 'boolean', default: false },
        blender: { type: 'boolean', default: false },
        check: { type: 'string' }
    }
});

/**
 * OLLAMA_HOST is often the address Ollama binds to — `0.0.0.0`, no scheme, no port — so it is read
 * the way Ollama's own CLI reads it.
 */
function ollamaUrl(raw) {
    const url = new URL(/^https?:\/\//.test(raw) ? raw : `http://${raw}`);
    if (url.hostname === '0.0.0.0') url.hostname = 'localhost';
    if (!url.port && !/:\d+/.test(raw)) url.port = '11434';
    return url.origin;
}

const RUNS = Number(opt.runs);
/** The runs of a task that writes records — one with a family skill. */
const AUTHORING_RUNS = Number(opt['authoring-runs'] ?? opt.runs);
const runsOf = task => task.skill ? AUTHORING_RUNS : RUNS;
const MAX_TURNS = Number(opt['max-turns']);
const SETTLE_SECONDS = Number(opt.settle);
const OLLAMA = ollamaUrl(opt.ollama);
/** The thinking level a run is given: --think true|false as OpenClaw's levels, any other as written. */
const THINKING = opt.think === undefined ? undefined
    : opt.think === 'true' ? 'medium' : opt.think === 'false' ? 'off' : opt.think;
/** One model turn may take minutes when the model does not fit the GPU. */
const TURN_TIMEOUT_MS = 20 * 60_000;

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outFile = path.resolve(opt.out ?? path.join(os.tmpdir(), 'skyrim-eval',
    `${stamp}-${opt.model.replace(/[^\w.-]/g, '_')}-${opt.profile}.json`));
fs.mkdirSync(path.dirname(outFile), { recursive: true });

// The core logs every request with console.error, as JSON over several lines: in the eval's own process, that goes to a
// file beside the record, as the MCP server's log did, and the eval's messages keep the console.
const printError = console.error.bind(console);
const pluginLog = fs.createWriteStream(outFile.replace(/\.json$/, '.plugin.log'));
console.error = (...parts) => { pluginLog.write(`${parts.map(String).join(' ')}\n`); };

/** What the eval leaves in the temp folder — the session's configuration holds the Nexus key — deleted however it ends. */
const leftovers = [];
function cleanUp() {
    for (const folder of leftovers.splice(0)) fs.rmSync(folder, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

function fail(message) {
    printError(`eval: ${message}`);
    cleanUp();
    stopBackends();
    process.exit(1);
}

process.on('SIGINT', () => fail('stopped (Ctrl+C); the session\'s configuration and projects were deleted.'));

if (!fs.existsSync(path.join(root, 'dist', 'index.js'))) fail('dist/index.js is missing — run npm run build first.');
// The plugin as OpenClaw runs it: OpenClaw loads this checkout's dist/ for every run, and the eval reads the instance
// through the same tools.
const dist = file => import(pathToFileURL(path.join(root, 'dist', file)).href);
const { pluginProduct, readSettings } = await dist('settings.js');
const { SkyrimTools, failureText } = await dist('tools.js');
const { agentInstructions } = await dist('instructions.js');

// --- The model's server: Ollama, or one with OpenAI's API ----------------------------------------

const configFile = openClawConfigFile(opt['openclaw-config']);
const SERVER = (() => {
    try { return providerServer(configFile, opt.provider, OLLAMA); } catch (error) { return fail(error.message); }
})();
const OPENAI = SERVER.api === 'openai-completions';
/** The server, named in messages and the round's entry. */
const SERVER_NAME = OPENAI ? `${opt.provider} (OpenAI API)` : 'Ollama';

async function request(base, route, body) {
    const response = await fetch(`${base.replace(/\/$/, '')}${route}`, {
        method: body ? 'POST' : 'GET',
        headers: body ? { 'content-type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(TURN_TIMEOUT_MS)
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`${SERVER_NAME} ${route} answered ${response.status}: ${text.slice(0, 500)}`);
    return JSON.parse(text);
}
const ollama = (route, body) => request(OLLAMA, route, body);
const openAi = (route, body) => request(SERVER.url, route, body);

if (OPENAI) {
    const served = await openAi('/models').catch(error => fail(`${SERVER_NAME} is not reachable at ${SERVER.url}: ${error.message}`));
    if (!served.data?.some(m => m.id === opt.model)) {
        fail(`${SERVER_NAME} serves no model '${opt.model}'. Served: ${(served.data ?? []).map(m => m.id).join(', ')}.`);
    }
} else {
    const tags = await ollama('/api/tags').catch(error => fail(`Ollama is not reachable at ${OLLAMA}: ${error.message}`));
    if (!tags.models.some(m => m.name === opt.model || m.model === opt.model)) {
        fail(`Ollama has no model '${opt.model}'. Pulled: ${tags.models.map(m => m.name).join(', ')}.`);
    }
}
const ollamaVersion = OPENAI ? undefined : (await ollama('/api/version').catch(() => ({}))).version;

// --- OpenClaw and the plugin --------------------------------------------------------------------

// A `let`: --check points it at each case's folder in turn.
let projectsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skyrim-eval-projects-'));
leftovers.push(projectsDir);
// The crash-log folder readCrashLog reads in a run: a crash task puts its one log there.
const crashLogDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skyrim-eval-crash-logs-'));
leftovers.push(crashLogDir);
// The Papyrus log folder readPapyrusLog reads in a run: a Papyrus task puts its one log there.
const papyrusLogDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skyrim-eval-papyrus-logs-'));
leftovers.push(papyrusLogDir);

// OpenClaw: its entry script, the proxy in front of the model's server, and the session's configuration.
const openClaw = await (async () => {
    const entry = openClawEntry(opt.openclaw)
        ?? fail('OpenClaw was not found: install it (npm install -g openclaw), or pass --openclaw <path to openclaw.mjs>.');
    let version;
    try { version = openClawVersion(entry); } catch (error) { fail(`OpenClaw did not start (${entry}): ${error.message}`); }
    if (!fs.existsSync(configFile)) fail(`OpenClaw's configuration ${configFile} does not exist: run openclaw onboard, or pass --openclaw-config.`);
    const proxy = await startProxy(SERVER.url, SERVER.api);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skyrim-eval-openclaw-'));
    leftovers.push(dir);
    let session;
    try {
        session = writeSessionConfig({
            dir, configFile, proxyUrl: proxy.baseUrl, provider: opt.provider, model: opt.model, root, projectsDir, crashLogDir, papyrusLogDir,
            agent: opt['openclaw-agent'], profile: opt.profile, allPlugins: opt['all-plugins'],
            blender: opt.blender || (opt.tasks ?? '').split(',').some(id => id.trim() === 'blender')
        });
    } catch (error) {
        fail(error.message);
    }
    return { entry, version, configFile, proxy, dir, ...session };
})();
/** The context the tasks run at: what OpenClaw asks Ollama for (nothing: Ollama's default), or an OpenAI server's window. */
const CTX = openClaw.numCtx;

// The plugin's tools, built, on the session's settings: the ground truth and the checks read the instance through them.
const product = pluginProduct(root);
// The session's folder for OpenClaw's state folder: its config names the projects folder, so the default is never used.
const settings = readSettings(openClaw.pluginConfig, root, openClaw.dir);
const backend = createBackend(settings.env, { product });
const plugin = new SkyrimTools(backend, product, settings.env);
const toolNames = new Set(plugin.toolNames());
/** The tools a run is offered: the profile's, less those it denies. */
const offered = plugin.listed.filter(tool => !NOT_ALLOWED.includes(tool.name));
const instructions = agentInstructions(backend.describe());
/** A line of the instructions the prompt hook adds, looked for in each run's system prompt. */
const instructionsLine = instructions.split('\n').find(line => line.trim().length > 40)?.trim();

/** One call through the plugin's tools, as text — what OpenClaw hands the model. */
async function callServer(name, args) {
    try {
        const result = await plugin.call(name, args);
        return { text: result.content.map(part => part.text ?? '').join(''), isError: false };
    } catch (error) {
        return { text: failureText(error), isError: true };
    }
}

async function callServerJson(name, args) {
    const { text, isError } = await callServer(name, args);
    if (isError) throw new Error(`${name} ${JSON.stringify(args)} failed: ${text}`);
    return JSON.parse(text);
}

// --- Ground truth, from the instance ------------------------------------------------------------

function stat(yaml, name) {
    const value = new RegExp(`^\\s+${name}:\\s*([\\d.]+)\\s*$`, 'm').exec(yaml)?.[1];
    if (value === undefined) fail(`could not read ${name} from the record text`);
    return Number(value);
}

async function weapon(editorId) {
    const read = await callServerJson('readRecord', { record: editorId });
    const yaml = read.versions[0].files.map(f => f.text).join('\n');
    return { formId: read.formId, editorId, damage: stat(yaml, 'Damage'), weight: stat(yaml, 'Weight') };
}

// Read before the first task: a commit made while the round runs is not the build it measured (round 32's first row named
// the commit made during its last task).
const BUILD = measuredBuild();
console.log(`eval: ${opt.model} @ num_ctx ${CTX ?? 'Ollama default'}, profile ${opt.profile}, ${RUNS} run(s) per task` +
    (AUTHORING_RUNS === RUNS ? '' : `, ${AUTHORING_RUNS} per authoring task`) + `, build ${BUILD}, ` +
    (OPENAI ? `${SERVER_NAME} at ${SERVER.url}` : `Ollama ${ollamaVersion ?? '?'}`));
console.log(`eval: through ${openClaw.version} (${openClaw.entry}), on the configuration ${openClaw.configFile}` +
    `${openClaw.agentId ? `, agent '${openClaw.agentId}'` : ''}` +
    `${openClaw.workspaceFiles.length ? ` with ${openClaw.workspaceFiles.map(f => f.name).join(', ')}` : ''}` +
    (openClaw.copiedFrom ? ` — ${opt.model} with the settings of its entry for ${openClaw.copiedFrom}` : '') +
    `, ${openClaw.plugins ? `the plugins ${openClaw.plugins.join(' and ')} alone` : 'all its plugins'}`);
console.log('eval: reading the ground truth from the instance (the first lookup builds the index)…');
const truth = {
    ironSword: await weapon('IronSword'),
    steelSword: await weapon('SteelSword'),
    nordRace: (await callServerJson('findRecords', { records: ['NordRace'], limit: 1 })).records[0]?.formId
        ?? fail('the instance has no NordRace'),
    femaleNordVoice: (await callServerJson('findRecords', { records: ['FemaleNord'], limit: 1 })).records[0]?.formId
        ?? fail('the instance has no FemaleNord voice'),
    // A note whose text has line breaks and quotes, and whose model path has backslashes: what a copy
    // has to carry over exactly.
    mavenNote: await (async () => {
        const read = await callServerJson('readRecord', { record: 'LetterRiftenBlackBriarMeadery04' });
        const file = read.versions[0].files.map(f => f.text).join('\n');
        const text = translatedValue(file, 'BookText');
        if (!text?.includes('"')) fail('could not read the text of Note From Maven');
        // Its lines and empty lines, which textCopied does not count: x-x-x.
        return { formId: read.formId, text, shape: lineShape(textValue(file, 'BookText')) };
    })(),
    // What the recipe task makes: every weapon named so (the honed one is named otherwise).
    ancientNordSword: await (async () => {
        const found = await callServerJson('findRecords', { text: 'Ancient Nord Sword', types: ['WEAP'], limit: 25 });
        const editorIds = found.records.filter(r => r.name?.toLowerCase() === 'ancient nord sword' && r.editorId)
            .map(r => r.editorId.toLowerCase());
        return editorIds.length ? { editorIds } : fail('the instance has no Ancient Nord Sword');
    })(),
    // What the leveled-list task adds: every weapon named Silver Sword, by FormKey.
    silverSword: await (async () => {
        const found = await callServerJson('findRecords', { text: 'Silver Sword', types: ['WEAP'], limit: 25 });
        const formIds = found.records.filter(r => r.name?.toLowerCase() === 'silver sword').map(r => r.formId.toLowerCase());
        return formIds.length ? { formIds } : fail('the instance has no Silver Sword');
    })(),
    // Where the world task puts its chest: Breezehome, the player's house in Whiterun.
    breezehome: await (async () => {
        const found = await callServerJson('findRecords', { text: 'Breezehome', types: ['CELL'], limit: 5 });
        const cell = found.records.find(r => r.name?.toLowerCase() === 'breezehome') ?? found.records[0];
        if (!cell) fail('the instance has no Breezehome cell');
        // Where the house is: what the game places in it — its containers and furniture, as readRecord lists them — spans these.
        const points = ((await callServerJson('readRecord', { record: cell.formId })).placed?.references ?? [])
            .map(r => r.position.split(',').map(Number)).filter(p => p.length === 3 && p.every(Number.isFinite));
        if (points.length < 5) fail('could not read what Breezehome places');
        const span = i => [Math.min(...points.map(p => p[i])), Math.max(...points.map(p => p[i]))];
        return { formId: cell.formId, editorId: cell.editorId, x: span(0), y: span(1), lowest: span(2)[0] };
    })(),
    // The damage the arrow task's simple prompt asks to beat.
    steelArrow: await (async () => {
        const read = await callServerJson('readRecord', { record: 'SteelArrow' });
        const damage = ammoDamage(read.versions[0].files.map(f => f.text).join('\n'));
        return Number.isFinite(damage) ? { damage } : fail('could not read the Steel Arrow\'s damage');
    })(),
    // The outdoor task's place: the grindstone at Alvor's smithy — of the grindstones in Riverwood's cells, the one nearest
    // its Blacksmith Forge — where the load order places it (readRecord's placedIn, core v0.2.59). Riverwood01's, 2,300 units
    // north, is no smithy's.
    grindstone: await (async () => {
        const where = async record => ((await callServerJson('readRecord', { record, in: 'Riverwood' })).placedIn?.in ?? [])
            .map(line => /: (-?\d+), (-?\d+), (-?\d+) — /.exec(line)?.slice(1, 4).map(Number)).filter(Boolean);
        const [forge] = await where('CraftingBlackSmithForge');
        const stones = await where('CraftingBlacksmithSharpeningWheel');
        if (!forge || stones.length === 0) return fail('could not find the grindstone at Riverwood\'s smithy');
        const far = at => Math.hypot(at[0] - forge[0], at[1] - forge[1]);
        return { position: stones.sort((a, b) => far(a) - far(b))[0] };
    })(),
    // The dialogue task's NPC: Hulda, who keeps the Bannered Mare in Whiterun.
    hulda: (await callServerJson('findRecords', { records: ['Hulda'], limit: 1 })).records[0]?.formId ?? fail('the instance has no Hulda'),
    // The settings task's setting: how high the player jumps, and the game's value.
    jump: await (async () => {
        const read = await callServerJson('readRecord', { record: 'fJumpHeightMin' });
        const value = Number(/^Data:[ \t]*(\S+)/m.exec(read.versions[0].files.map(f => f.text).join('\n'))?.[1]);
        return Number.isFinite(value) ? { formId: read.formId, value } : fail('could not read fJumpHeightMin');
    })(),
    // The keyword task's keywords: the Iron Sword's own, and silver's.
    ironSwordKeywords: await (async () => {
        const read = await callServerJson('readRecord', { record: 'IronSword' });
        return listOf(read.versions[0].files.map(f => f.text).join('\n'), 'Keywords').map(k => k.toLowerCase());
    })(),
    silver: (await callServerJson('findRecords', { records: ['WeapMaterialSilver'], limit: 1 })).records[0]?.formId?.toLowerCase()
        ?? fail('the instance has no WeapMaterialSilver'),
    // The conflict task's record: Deep Folk Crossing, whose winner (Dragonborn.esm's) lost Dawnguard.esm's keywords and cell.
    deepFolk: await (async () => {
        const read = await callServerJson('readRecord', { record: 'DeepFolkCrossingLocation', allVersions: true });
        const of = plugin => read.versions.find(v => v.plugin.toLowerCase() === plugin)?.files.map(f => f.text).join('\n') ?? '';
        const dawnguard = of('dawnguard.esm');
        const keywords = listOf(dawnguard, 'Keywords').map(k => k.toLowerCase());
        const cells = [...blockOf(dawnguard, 'WorldspaceCellsAdded').matchAll(/^[ \t]*-[ \t]*['"]?(-?\d+),[ \t]*(-?\d+)/gm)].map(m => `${m[1]},${m[2]}`);
        if (read.winner.toLowerCase() !== 'dragonborn.esm' || keywords.length === 0 || cells.length === 0)
            fail('Deep Folk Crossing is no longer the conflict the conflict task asks about');
        return { formId: read.formId, keywords, cells };
    })(),
    // The Blender task's object: the Thieves Guild strongbox in Whiterun Stables.
    strongbox: await (async () => {
        const read = await callServerJson('readRecord', { record: 'WhiterunStables' });
        const hit = (read.placed?.references ?? []).find(r => /^TGRStrongbox\b/.test(r.base));
        const base = (await callServerJson('findRecords', { records: ['TGRStrongbox'], limit: 1 })).records[0];
        if (!hit || !base) return fail('could not find the strongbox in Whiterun Stables');
        return { formId: hit.formId, base: base.formId, position: hit.position.split(',').map(Number), rotation: hit.rotation.split(',').map(Number) };
    })()
};

// --- Tasks --------------------------------------------------------------------------------------

function filesUnder(dir) {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir, { withFileTypes: true, recursive: true })
        .filter(entry => entry.isFile())
        .map(entry => path.join(entry.parentPath ?? entry.path, entry.name));
}

/** The text of the project's copy of a record, found by its FormKey. */
function recordText(project, formId) {
    for (const file of filesUnder(path.join(projectsDir, project, 'plugin'))) {
        if (!file.endsWith('.yaml')) continue;
        const text = fs.readFileSync(file, 'utf8');
        if (text.includes(`FormKey: ${formId}`)) return text;
    }
    return undefined;
}

/**
 * Every record file of a project, with its group folder (`weapons`, `spells`, `npcs`…) and FormKey, and
 * the project's own plugin. After a build, a new record's FormKey names that plugin; an override's
 * names the plugin it comes from.
 */
function projectRecords(project) {
    const pluginDir = path.join(projectsDir, project, 'plugin');
    const header = path.join(pluginDir, 'RecordData.yaml');
    const plugin = fs.existsSync(header) ? /^ModKey:\s*(.+?)\s*$/m.exec(fs.readFileSync(header, 'utf8'))?.[1] : undefined;
    const records = filesUnder(pluginDir).filter(file => file.endsWith('.yaml') && file !== header).map(file => {
        const text = fs.readFileSync(file, 'utf8');
        const relative = path.relative(pluginDir, file);
        return { group: relative.split(path.sep)[0].toLowerCase(), file: relative.replaceAll(path.sep, '/'), text, formKey: /^FormKey:\s*(\S+)/m.exec(text)?.[1] };
    });
    return { plugin, records };
}

/** Whether a project's plugin overrides no record of another plugin — for the tasks that ask for new records alone (overridesIn). */
function noOverride(project) {
    const { plugin, records } = projectRecords(project);
    return !!plugin && overridesIn(plugin, records).length === 0;
}

/** The records of one group that the project's own plugin defines — new ones, not overrides. */
function newRecords(project, group) {
    const { plugin, records } = projectRecords(project);
    return records.filter(r => r.group === group && plugin && r.formKey?.toLowerCase().endsWith(`:${plugin.toLowerCase()}`));
}

/**
 * A record's in-game name, as Spriggit writes it (Name → Value), in YAML's flow style
 * (`Name: { TargetLanguage: English, Value: Hilda }`, which the build reads too), or as a plain string.
 */
function nameOf(text) {
    const nested = /^Name:[ \t]*\r?\n(?:[ \t]+.*\r?\n)*?[ \t]+Value:[ \t]*(.+?)[ \t]*\r?$/m.exec(text)?.[1];
    const flow = /^Name:[ \t]*\{[^}]*?\bValue:[ \t]*([^,}]+?)[ \t]*[,}]/m.exec(text)?.[1];
    const inline = /^Name:[ \t]*(\S.*?)[ \t]*\r?$/m.exec(text)?.[1];
    return (nested ?? flow ?? inline ?? '').replace(/^['"]|['"]$/g, '');
}

/** Whether a record's flags list one, as a block list (`- Female`) or a flow list (`Flags: [Female, Unique]`). */
const hasFlag = (text, flag) =>
    new RegExp(`^[ \\t]+- ${flag}[ \\t]*\\r?$`, 'm').test(text) || new RegExp(`Flags:[ \\t]*\\[[^\\]]*\\b${flag}\\b`).test(text);

/** The magic effects a spell or an enchantment lists. */
const effectsOf = text => [...text.matchAll(/BaseEffect:[ \t]*([^\s#]+)/g)].map(m => m[1]);

/**
 * The FormKey a link of a project's record names: a FormID as written; an editor ID as the build resolves it — the
 * project's own record, the pin in its links.lock.json, the load order's record. Since round 48 the build keeps links
 * written by editor ID in the files, where it wrote them as FormIDs before: the checks resolve them as it does.
 */
async function linkTarget(project, link) {
    if (!link) return undefined;
    if (/^[0-9A-Fa-f]{6}:\S+\.es[mpl]$/i.test(link)) return link;
    const id = link.split(':')[0].toLowerCase();
    const own = projectRecords(project).records.find(r => /^EditorID:[ \t]*(\S+)/m.exec(r.text)?.[1]?.toLowerCase() === id);
    if (own?.formKey) return own.formKey;
    try {
        const pins = JSON.parse(fs.readFileSync(path.join(projectsDir, project, 'links.lock.json'), 'utf8'));
        const pinned = Object.entries(pins).find(([editorId]) => editorId.toLowerCase() === id)?.[1];
        if (pinned) return pinned;
    } catch { /* no pins yet */ }
    try {
        return (await callServerJson('findRecords', { records: [link.split(':')[0]], limit: 1 })).records[0]?.formId;
    } catch {
        return undefined;
    }
}

/** The editor ID of the record a link names: the project's own, or the load order's. */
async function editorIdOf(project, link) {
    const formKey = await linkTarget(project, link);
    if (!formKey) return undefined;
    const own = projectRecords(project).records.find(r => r.formKey?.toLowerCase() === formKey.toLowerCase());
    if (own) return /^EditorID:[ \t]*(\S+)/m.exec(own.text)?.[1];
    try {
        return (await callServerJson('findRecords', { records: [formKey], limit: 1 })).records[0]?.editorId ?? undefined;
    } catch {
        return undefined;
    }
}

/** A record's text wherever it is: written in the project, or in the load order (read through the plugin's tools). */
async function recordAnywhere(project, link) {
    const formKey = await linkTarget(project, link);
    if (!formKey) return '';
    const own = projectRecords(project).records.find(r => r.formKey?.toLowerCase() === formKey.toLowerCase());
    if (own) return own.text;
    try {
        const read = await callServerJson('readRecord', { record: formKey });
        return read.versions[0].files.map(f => f.text).join('\n');
    } catch {
        return '';
    }
}

/**
 * The race and sex an NPC has in game, as each NPC it may be: its own Race line and Female flag — or, with Traits among
 * its TemplateFlags, its template's, an NPC's or each NPC of a leveled list's, followed through their own such templates
 * and lists. A Hilda written Nord over a flame atronach's template with Traits is an atronach in game, and round 79's
 * npc #3 wrote one, which the Race line passed. A template no record of the load order or the project is, as `000000`,
 * gives nothing: the NPC is its own.
 */
async function npcTraits(project, text, depth = 0) {
    if (depth > 8) return [];
    const listed = /^Race:/m.test(text) ? [] : [...new Set([...text.matchAll(/^[ \t]+Reference:[ \t]*([^\s#]+)/gm)].map(m => m[1]))];
    if (listed.length) {
        return (await Promise.all(listed.map(async npc => npcTraits(project, await recordAnywhere(project, npc), depth + 1)))).flat();
    }
    const template = /^Template:[ \t]*([^\s#]+)/m.exec(text)?.[1];
    const given = template && hasFlag(text, 'Traits') ? await recordAnywhere(project, template) : '';
    if (given) return npcTraits(project, given, depth + 1);
    return [{ race: await linkTarget(project, /^Race:[ \t]*([^\s#]+)/m.exec(text)?.[1]), female: hasFlag(text, 'Female') }];
}

/** The magic effects behind a spell or an enchantment, as text, wherever each is. */
async function effectTexts(project, text) {
    return Promise.all(effectsOf(text).map(effect => recordAnywhere(project, effect)));
}

/** A magic effect a fire resistance lowers: fire damage. */
const FIRE = /^ResistValue:[ \t]*ResistFire[ \t]*\r?$/m;

/** Each item of a record's Effects list: the magic effect it names, its Magnitude (NaN where it has none) and Duration. */
function effectItems(text) {
    const list = /^Effects:[ \t]*\r?\n((?:[ \t]*-.*\r?\n|[ \t]+.*\r?\n)*)/m.exec(`${text}\n`)?.[1] ?? '';
    const indent = /^([ \t]*)-/.exec(list)?.[1] ?? '';
    return list.split(new RegExp(`^${indent}-`, 'm')).slice(1)
        .map(item => ({
            effect: /BaseEffect:[ \t]*([^\s#]+)/.exec(item)?.[1],
            magnitude: Number(/Magnitude:[ \t]*(-?[\d.]+)/.exec(item)?.[1]),
            duration: Number(/Duration:[ \t]*(-?[\d.]+)/.exec(item)?.[1] ?? 0)
        }))
        .filter(item => item.effect);
}

/**
 * A fire effect that shows its burn where it hits: the game's weapon fire, EnchFireDamageFFContact, has FireFXShader.
 * Round 103's sword+detailed #5 cast a Dark Brotherhood trap's Heavy Fire Damage, Painless and with no shader, and
 * passed: in game the sword burned unseen.
 */
const BURN = /^HitShader:[ \t]*\S/m;

/**
 * The sword task's records: the project's new sword named Flame Blade; the enchantment it names — its `formKey` where
 * the project has that record, its `text` wherever it is; that enchantment's magic effects, as text; and its Effects
 * items, each with its magic effect's text and its magnitude.
 */
async function flameBlade() {
    const sword = newRecords('FlameBlade', 'weapons').find(r => /^flame blade$/i.test(nameOf(r.text)));
    const link = sword && /^ObjectEffect:[ \t]*([^\s#]+)/m.exec(sword.text)?.[1];
    if (!link) return { sword, effects: [], items: [] };
    const formKey = await linkTarget('FlameBlade', link);
    const own = formKey && projectRecords('FlameBlade').records.find(r => r.formKey?.toLowerCase() === formKey.toLowerCase());
    const text = await recordAnywhere('FlameBlade', link);
    const items = await Promise.all(effectItems(text).map(async ({ effect, magnitude, duration }) =>
        ({ text: await recordAnywhere('FlameBlade', effect), magnitude, duration })));
    return { sword, enchantment: { formKey: own ? formKey : undefined, text }, effects: await effectTexts('FlameBlade', text), items };
}

/**
 * Whether the game draws the record: its model a mesh the game has — loose in a mod or in an archive of the load order, as
 * the core finds files — or one in the project's assets, which deploy copies into the mod. Round 105's sword #1, #3 and #5
 * built Flame Blades on mesh paths of their own making, which the game draws nothing for, and passed.
 */
async function modelInGame(project, text) {
    return modelFileInGame(project, modelOf(text));
}

/** Whether the game has a model file: loose in a mod, in an archive of the load order, or in the project's assets. */
async function modelFileInGame(project, model) {
    if (!model) return false;
    if ((await backend.findGameFiles([model]))[model]) return true;
    const asset = path.join('meshes', ...model.split(/[\\/]+/)).toLowerCase();
    const assets = path.join(projectsDir, project, 'assets');
    return filesUnder(assets).some(file => path.relative(assets, file).toLowerCase() === asset);
}

/**
 * A field's block at the margin — `WorldModel:` and the lines deeper below it, or the items of a list Spriggit writes
 * at the margin (`Armature:` then `- 0179B0:Skyrim.esm`) — or '' where the record has none.
 */
function blockOf(text, field) {
    return new RegExp(`^${field}:[ \\t]*\\r?\\n((?:[ \\t]+.*(?:\\r?\\n|$)|-(?:[ \\t].*)?(?:\\r?\\n|$)|[ \\t]*\\r?\\n)*)`, 'm')
        .exec(text ?? '')?.[1] ?? '';
}

/** The first model file a block names as YAML reads it, a quoted path decoded: an armor's or armor addon's `WorldModel`. */
function fileIn(block) {
    const raw = /^[ \t]+File:[ \t]*(.+?)[ \t]*\r?$/m.exec(block)?.[1];
    return (raw && scalarValue(raw, [])) || undefined;
}

/** The items of a list at the margin (`Keywords:`, `Armature:`), as block or flow list, their comments left out. */
function listOf(text, field) {
    const flow = new RegExp(`^${field}:[ \\t]*\\[([^\\]\\r\\n]*)\\]`, 'm').exec(text ?? '')?.[1];
    if (flow !== undefined) return flow.split(',').map(item => item.trim()).filter(Boolean);
    return [...blockOf(text, field).matchAll(/^[ \t]*-[ \t]*([^\s#]+)/gm)].map(m => m[1]);
}

/** A magic effect that raises frost resistance: its archetype's actor value. */
const FROST_RESIST = /^[ \t]+ActorValue:[ \t]*ResistFrost[ \t]*\r?$/m;

/**
 * A magic effect cast for as long as its item is worn: ConstantEffect, the default the serializer leaves out — the
 * game's EnchResistFrostConstantSelf has no CastType line.
 */
const CONSTANT = { test: text => !/^CastType:/m.test(text) || /^CastType:[ \t]*ConstantEffect[ \t]*\r?$/m.test(text) };

/**
 * The armor task's records: the project's new helmet named Frostguard Helm; the armor addons its Armature names, each as
 * text wherever it is; the enchantment it names — its `formKey` where the project has that record, its `text` wherever it
 * is — and that enchantment's Effects items, each with its magic effect's text and its magnitude.
 */
async function frostguardHelm() {
    const project = 'FrostGuard';
    const helm = newRecords(project, 'armors').find(r => /^frostguard helm$/i.test(nameOf(r.text)));
    if (!helm) return { helm, addons: [], items: [] };
    const addons = await Promise.all(listOf(helm.text, 'Armature').map(link => recordAnywhere(project, link)));
    const link = /^ObjectEffect:[ \t]*([^\s#]+)/m.exec(helm.text)?.[1];
    if (!link) return { helm, addons, items: [] };
    const formKey = await linkTarget(project, link);
    const own = formKey && projectRecords(project).records.find(r => r.formKey?.toLowerCase() === formKey.toLowerCase());
    const text = await recordAnywhere(project, link);
    const items = await Promise.all(effectItems(text).map(async ({ effect, magnitude }) =>
        ({ text: await recordAnywhere(project, effect), magnitude })));
    return { helm, addons, enchantment: { formKey: own ? formKey : undefined, text }, items };
}

/** A magic effect that changes Health, and one that harms: a restoring effect is the first and not the second. */
const HEALTH = /^[ \t]+ActorValue:[ \t]*Health[ \t]*\r?$/m;
const DETRIMENTAL = /^[ \t]*-[ \t]*Detrimental[ \t]*\r?$|Flags:[ \t]*\[[^\]\r\n]*\bDetrimental\b/m;

/** A magic effect given all at once: no duration, or flagged so. */
const atOnce = (duration, text) => duration === 0 || /^[ \t]*-[ \t]*NoDuration[ \t]*\r?$|Flags:[ \t]*\[[^\]\r\n]*\bNoDuration\b/m.test(text);

/**
 * The potion task's records: the project's new potion named Healing Draught, and its Effects items, each with its magic
 * effect's text, its magnitude and its duration.
 */
async function healingDraught() {
    const potion = newRecords('HealingDraught', 'ingestibles').find(r => /^healing draught$/i.test(nameOf(r.text)));
    const items = potion ? await Promise.all(effectItems(potion.text).map(async ({ effect, magnitude, duration }) =>
        ({ text: await recordAnywhere('HealingDraught', effect), magnitude, duration }))) : [];
    return { potion, items };
}


/**
 * The recipe task's records: the project's new recipe that makes the Ancient Nord Sword, with the editor IDs of what it
 * makes, where, and from what, each material with its count; and the editor IDs its conditions name.
 */
async function nordSwordRecipe() {
    const project = 'NordSwordRecipe';
    const recipes = await Promise.all(newRecords(project, 'constructibleobjects').map(async r => ({
        ...r,
        makes: await editorIdOf(project, /^CreatedObject:[ \t]*([^\s#]+)/m.exec(r.text)?.[1])
    })));
    const recipe = recipes.find(r => truth.ancientNordSword.editorIds.includes(r.makes?.toLowerCase()));
    if (!recipe) return { recipe, materials: [], conditions: [], perks: [] };
    const at = await editorIdOf(project, /^WorkbenchKeyword:[ \t]*([^\s#]+)/m.exec(recipe.text)?.[1]);
    // A recipe's materials are written as a container's items are.
    const materials = await Promise.all(containerItems(recipe.text).map(async ({ link, count }) => ({ id: await editorIdOf(project, link), count })));
    const linked = [...blockOf(recipe.text, 'Conditions').matchAll(/^[ \t]+\w+:[ \t]*([0-9A-Fa-f]{6}:\S+\.es[mpl]|[A-Za-z]\w*)[ \t]*(?:#.*)?\r?$/gm)]
        .map(m => m[1]).filter(link => /^[0-9A-Fa-f]{6}:/.test(link)
            || !/^(?:Mutagen|Condition|Equal|Greater|Less|NotEqual|Subject|Target|Reference|None|True|False)/.test(link));
    const conditions = (await Promise.all(linked.map(link => editorIdOf(project, link)))).filter(Boolean);
    return { recipe, at, materials, conditions, perks: await perksRequired(project, recipe.text) };
}

/**
 * The perks a record's conditions require the player to have: a HasPerk condition the player meets with the perk — equal to
 * 1 (EqualTo is the default the serializer leaves out), at least 1, more than 0, not 0. Since round 128: any condition
 * naming SteelSmithing passed, and recipe+detailed #3's `CompareOperator: NotEqualTo` with 1, copied from a tempering
 * recipe, shows the recipe only to a player without the perk.
 */
async function perksRequired(project, text) {
    const required = [];
    for (const item of entriesOf(text, 'Conditions')) {
        if (!/\bHasPerkConditionData\b/.test(item)) continue;
        const perk = /\bPerk:[ \t]*([^\s#,}]+)/.exec(item)?.[1];
        const operator = /\bCompareOperator:[ \t]*(\w+)/.exec(item)?.[1] ?? 'EqualTo';
        const value = Number(/\bComparisonValue:[ \t]*(['"]?)(-?[\d.]+)\1/.exec(item)?.[2] ?? 0);
        const has = operator === 'EqualTo' && value === 1 || operator === 'GreaterThanOrEqualTo' && value === 1
            || operator === 'GreaterThan' && value === 0 || operator === 'NotEqualTo' && value === 0;
        if (has && perk) required.push(await editorIdOf(project, perk));
    }
    return required.filter(Boolean);
}

/** Whether a recipe's materials are just these, each as many as given: `{ IngotIron: 2, LeatherStrips: 1 }`. */
const materialsAre = (materials, wanted) => {
    const counts = {};
    for (const { id, count } of materials) if (id) counts[id.toLowerCase()] = (counts[id.toLowerCase()] ?? 0) + count;
    const want = Object.entries(wanted).map(([id, count]) => [id.toLowerCase(), count]);
    return Object.keys(counts).length === want.length && want.every(([id, count]) => counts[id] === count);
};

/** An ammunition's damage as written, a comment after it left out; NaN where it has none. */
function ammoDamage(text) {
    return Number(/^[ \t]*Damage:[ \t]*(['"]?)(-?[\d.]+)\1(?:[ \t]+#.*)?[ \t]*\r?$/m.exec(text ?? '')?.[2] ?? NaN);
}

/**
 * The ammunition task's records: the project's new arrow named Hunter's Arrow, and the projectile it names as text,
 * wherever it is.
 */
async function huntersArrow() {
    const arrow = newRecords('HuntersArrow', 'ammunitions').find(r => /^hunter'?s arrows?$/i.test(nameOf(r.text)));
    const link = arrow && /^Projectile:[ \t]*([^\s#]+)/m.exec(arrow.text)?.[1];
    return { arrow, projectile: link ? await recordAnywhere('HuntersArrow', link) : '' };
}

/** A magic effect a shock resistance lowers: shock damage. */
const SHOCK = /^ResistValue:[ \t]*ResistShock[ \t]*\r?$/m;

/** Whether a record's FormKey is the project's own plugin's: a new record of it, not the load order's. */
async function ownRecord(project, link) {
    const formKey = link && await linkTarget(project, link);
    const { plugin } = projectRecords(project);
    return !!formKey && !!plugin && formKey.toLowerCase().endsWith(`:${plugin.toLowerCase()}`);
}

/**
 * The shout task's records: the project's new shout named Thunder Roar, and each of its words in order — the word of
 * power as text, wherever it is, and whether it is the project's; the spell the word casts, as text; that spell's Effects
 * items with their magic effects' texts, magnitudes and durations; and the word's recovery time.
 */
async function thunderRoar() {
    const project = 'ThunderRoar';
    const shout = newRecords(project, 'shouts').find(r => /^thunder roar$/i.test(nameOf(r.text)));
    if (!shout) return { shout, words: [] };
    const entries = blockOf(shout.text, 'WordsOfPower').split(/^[ \t]*-[ \t]*/m).slice(1);
    const words = await Promise.all(entries.map(async entry => {
        const word = /\bWord:[ \t]*([^\s#]+)/.exec(entry)?.[1];
        const spell = /\bSpell:[ \t]*([^\s#]+)/.exec(entry)?.[1];
        const spellText = spell ? await recordAnywhere(project, spell) : '';
        return {
            wordText: word ? await recordAnywhere(project, word) : '',
            ownWord: await ownRecord(project, word),
            spellText,
            items: await Promise.all(effectItems(spellText).map(async ({ effect, magnitude, duration }) =>
                ({ text: await recordAnywhere(project, effect), magnitude, duration }))),
            recovery: Number(/RecoveryTime:[ \t]*(['"]?)(-?[\d.]+)\1/.exec(entry)?.[2] ?? NaN)
        };
    }));
    return { shout, words };
}

/** The shock damage a word's spell deals, as the game deals it: the largest of its shock effects'. */
const shockDealt = word => Math.max(0, ...word.items.filter(({ text }) => SHOCK.test(text))
    .map(({ text, magnitude, duration }) => dealtDamage(magnitude, duration, text)));

/** A magic effect that changes carry weight, and one that gives back what it changed when it ends. */
const CARRY = /^[ \t]+ActorValue:[ \t]*CarryWeight[ \t]*\r?$/m;
const RECOVER = /^[ \t]*-[ \t]*Recover[ \t]*\r?$|Flags:[ \t]*\[[^\]\r\n]*\bRecover\b/m;

/**
 * The effect task's records: the project's new spell named Feather Step, and its Effects items, each with its magic
 * effect's text, magnitude and duration, and whether that magic effect is the project's own.
 */
async function featherStep() {
    const project = 'FeatherStep';
    const spell = newRecords(project, 'spells').find(r => /^feather step$/i.test(nameOf(r.text)));
    const items = spell ? await Promise.all(effectItems(spell.text).map(async ({ effect, magnitude, duration }) =>
        ({ text: await recordAnywhere(project, effect), magnitude, duration, own: await ownRecord(project, effect) }))) : [];
    return { spell, items, own: items.filter(item => item.own) };
}

/**
 * A list's items — a leveled list's entries, a container's items, a perk's effects — each split off at its `-` as deep
 * as the first, as text: a list inside an item (a perk effect's conditions) stays in it.
 */
function entriesOf(text, field) {
    const block = blockOf(text, field);
    const indent = /^([ \t]*)-/m.exec(block)?.[1];
    return indent === undefined ? [] : block.split(new RegExp(`^${indent}-(?=[ \\t]|\\r?$)`, 'm')).slice(1);
}

/** A leveled list's entries: the record each names, at what level, how many. */
function leveledEntries(text) {
    return entriesOf(text, 'Entries').map(entry => ({
        reference: /\bReference:[ \t]*([^\s#]+)/.exec(entry)?.[1],
        level: Number(/\bLevel:[ \t]*(\d+)/.exec(entry)?.[1] ?? NaN),
        count: Number(/\bCount:[ \t]*(\d+)/.exec(entry)?.[1] ?? 1)
    })).filter(entry => entry.reference);
}

/**
 * The leveled-list task's records: the project's copies of the load order's leveled item lists whose editor ID names
 * bandits, each with its entries resolved to FormKeys, and the entries of the list as the load order has it.
 */
async function banditLists() {
    const project = 'BanditSilver';
    const { plugin, records } = projectRecords(project);
    const copies = records.filter(r => r.group === 'leveleditems' && r.formKey && plugin && !r.formKey.toLowerCase().endsWith(`:${plugin.toLowerCase()}`)
        && /bandit/i.test(/^EditorID:[ \t]*(\S+)/m.exec(r.text)?.[1] ?? ''));
    const own = newRecords(project, 'leveleditems');
    const resolve = list => Promise.all(list.map(async e => ({ ...e, formKey: (await linkTarget(project, e.reference))?.toLowerCase() })));
    /**
     * The levels at which a list's entries hand out the Silver Sword: an entry naming it, or one naming a leveled list of the
     * project's own that does, a few lists down — the highest level on the way. Round 136's leveled #3 added a list of its own
     * holding the sword to the bandits' one-handed weapons, every bandit able to carry it, and failed a check that looked
     * for the sword in the bandits' list alone.
     */
    const silverLevels = async (entries, depth = 0) => {
        const levels = [];
        for (const e of entries) {
            if (truth.silverSword.formIds.includes(e.formKey)) levels.push(e.level);
            const inner = depth < 3 && own.find(r => r.formKey?.toLowerCase() === e.formKey);
            if (inner) for (const level of await silverLevels(await resolve(leveledEntries(inner.text)), depth + 1)) levels.push(Math.max(level, e.level));
        }
        return levels;
    };
    return Promise.all(copies.map(async copy => {
        let theirs = [];
        try {
            const read = await callServerJson('readRecord', { record: copy.formKey });
            theirs = await resolve(leveledEntries(read.versions[0].files.map(f => f.text).join('\n')));
        } catch { /* a list the load order has not */ }
        const entries = await resolve(leveledEntries(copy.text));
        return { ...copy, entries, theirs, silver: await silverLevels(entries) };
    }));
}

/** Whether a list keeps every entry the load order's has: each, with its level and count, as many times as there. */
const keepsEntries = (entries, theirs) => {
    const key = e => `${e.formKey}|${e.level}|${e.count}`;
    const left = entries.map(key);
    return theirs.length > 0 && theirs.every(e => {
        const at = left.indexOf(key(e));
        if (at < 0) return false;
        left.splice(at, 1);
        return true;
    });
};

/** A container's or recipe's items: the record each names and how many (`Item:` under `Item:`, as Spriggit writes them). */
function containerItems(text) {
    return entriesOf(text, 'Items').map(item => ({
        link: /\bItem:[ \t]*([^\s#{]+)[ \t]*(?:#.*)?$/m.exec(item)?.[1],
        count: Number(/\bCount:[ \t]*(\d+)/.exec(item)?.[1] ?? NaN)
    })).filter(item => item.link);
}

/**
 * The world task's records: the project's files under its cells that place an object in Breezehome, each with the text
 * of the base record it places — a container, the project's own or the load order's — and that container's items by
 * editor ID with their counts.
 */
async function breezehomeChests() {
    const project = 'BreezehomeChest';
    const { records } = projectRecords(project);
    const cell = truth.breezehome;
    const inCell = records.filter(r => (r.group === 'cells' || r.group === 'worldspaces')
        && (r.text.includes(cell.formId) || r.file.toLowerCase().includes(cell.editorId.toLowerCase())
            || r.file.includes(cell.formId.replace(':', '_'))));
    const placed = inCell.flatMap(r => [...r.text.matchAll(/^[ \t]*(?:-[ \t]*)?Base:[ \t]*([^\s#]+)/gm)]
        .map(m => ({ base: m[1], position: positionOf(r.text) })));
    return Promise.all(placed.map(async ({ base, position }) => {
        const text = await recordAnywhere(project, base);
        // A container: the project's own in its Containers folder, or a CONT of the load order.
        const formKey = (await linkTarget(project, base))?.toLowerCase();
        const ownFile = records.find(r => r.formKey?.toLowerCase() === formKey);
        let isContainer = ownFile ? ownFile.group === 'containers' : false;
        if (!ownFile && formKey) {
            try {
                isContainer = (await callServerJson('findRecords', { records: [formKey], limit: 1 })).records[0]?.signature === 'CONT';
            } catch { /* a base the load order has not */ }
        }
        const container = isContainer ? text : '';
        const items = await Promise.all(containerItems(container).map(async ({ link, count }) => ({ id: (await editorIdOf(project, link))?.toLowerCase(), count })));
        return { base, own: await ownRecord(project, base), text: container, items, position };
    })).then(all => all.filter(chest => chest.text));
}

/**
 * A placed reference's Position, `x, y, z` — quoted as editRecord writes it, or not; 0, 0, 0 — where the game puts one with
 * none — where it has none.
 */
function positionOf(text) {
    const at = /^[ \t]+Position:[ \t]*['"]?(-?[\d.]+)[ \t]*,[ \t]*(-?[\d.]+)[ \t]*,[ \t]*(-?[\d.]+)/m.exec(text);
    return at ? at.slice(1, 4).map(Number) : [0, 0, 0];
}

/**
 * Whether a position is in Breezehome where the player finds what is there: no more than 32 units below the lowest thing the
 * game places in it, and no more than 96 beyond them across the floor. Since round 128: world #4 passed with its chest at
 * 0, 0, 0, 64 units below the ground floor and 110 east of the easternmost container — under the floor in game.
 */
const inTheHouse = ([x, y, z]) => {
    const { x: [minX, maxX], y: [minY, maxY], lowest } = truth.breezehome;
    return z >= lowest - 32 && x >= minX - 96 && x <= maxX + 96 && y >= minY - 96 && y <= maxY + 96;
};

/** How many of an item a container holds, by the item's editor ID. */
const holds = (chest, editorId) => chest.items.filter(i => i.id === editorId.toLowerCase()).reduce((n, i) => n + (i.count || 0), 0);

/**
 * The outdoor task's records: the project's references placed in an exterior cell — a file in a cell's Temporary or
 * Persistent folder under Worldspaces/ — each with the container it places, its items, its position, and the grid of
 * the cell whose folder it is in.
 */
async function outdoorChests(project) {
    const { records } = projectRecords(project);
    const placed = records.filter(r => r.group === 'worldspaces' && /\/(Temporary|Persistent)\/[^/]+$/.test(r.file)
        && /^MutagenObjectType:[ \t]*PlacedObject/m.test(r.text));
    return Promise.all(placed.map(async r => {
        const base = /^Base:[ \t]*([^\s#]+)/m.exec(r.text)?.[1];
        if (!base) return undefined;
        const formKey = (await linkTarget(project, base))?.toLowerCase();
        const ownFile = records.find(o => o.formKey?.toLowerCase() === formKey);
        let isContainer = ownFile ? ownFile.group === 'containers' : false;
        if (!ownFile && formKey) {
            try {
                isContainer = (await callServerJson('findRecords', { records: [formKey], limit: 1 })).records[0]?.signature === 'CONT';
            } catch { /* a base the load order has not */ }
        }
        if (!isContainer) return undefined;
        const text = await recordAnywhere(project, base);
        const items = await Promise.all(containerItems(text).map(async ({ link, count }) => ({ id: (await editorIdOf(project, link))?.toLowerCase(), count })));
        const cellFile = path.join(projectsDir, project, 'plugin', ...r.file.split('/').slice(0, -2), 'RecordData.yaml');
        const grid = fs.existsSync(cellFile)
            ? /^[ \t]+Point:[ \t]*(-?\d+)[ \t]*,[ \t]*(-?\d+)/m.exec(fs.readFileSync(cellFile, 'utf8'))?.slice(1, 3).map(Number) : undefined;
        return { base, own: await ownRecord(project, base), text, items, position: positionOf(r.text), grid };
    })).then(all => all.filter(Boolean));
}

/** Within `reach` units of a point across the ground, x and y. */
const within = (a, b, reach) => Math.hypot(a[0] - b[0], a[1] - b[1]) <= reach;

/** A position in the square of the exterior cell whose folder holds it: x and y over 4096, rounded down, its grid. */
const inItsGrid = chest => !!chest.grid && Math.floor(chest.position[0] / 4096) === chest.grid[0] && Math.floor(chest.position[1] / 4096) === chest.grid[1];

/**
 * A call of Blender's MCP server — any of its tools, by the name OpenClaw gives it (`blender__execute_blender_code_for_cli`), or
 * through Tool Search, `dispatch_action` with its id (`mcp:blender:blender__execute_blender_code_for_cli`), as Strata's first
 * Blender run called them.
 */
const blenderCalls = calls => calls.filter(c => /^blender__|execute_blender_code/.test(c.name ?? '')
    || c.name === 'dispatch_action' && /blender__/.test(String(c.args?.id ?? '')));

/** The Blender task's references: the project's copy of the strongbox, and the new ones placing a strongbox. */
function stablesStrongboxes(project) {
    const { plugin, records } = projectRecords(project);
    const placed = records.filter(r => r.group === 'cells' && /^MutagenObjectType:[ \t]*PlacedObject/m.test(r.text));
    const [id, master] = truth.strongbox.formId.split(':');
    const isTheBox = r => r.formKey?.toLowerCase() === truth.strongbox.formId.toLowerCase()
        || r.file.toLowerCase().endsWith(`${id}_${master}.yaml`.toLowerCase());
    const placesBox = r => new RegExp(`^Base:[ \\t]*(?:${truth.strongbox.base.replace('.', '\\.')}|TGRStrongbox)\\b`, 'mi').test(r.text);
    return {
        copy: placed.find(isTheBox),
        added: placed.filter(r => !isTheBox(r) && placesBox(r) && (!r.formKey || r.formKey.toLowerCase().endsWith(`:${plugin?.toLowerCase()}`)))
    };
}

/** A placed reference's Rotation, x, y, z in radians — 0, 0, 0 where it has none. */
function rotationOf(text) {
    const at = /^[ \t]+Rotation:[ \t]*['"]?(-?[\d.]+)[ \t]*,[ \t]*(-?[\d.]+)[ \t]*,[ \t]*(-?[\d.]+)/m.exec(text);
    return at ? at.slice(1, 4).map(Number) : [0, 0, 0];
}

/** Two angles a quarter turn apart, either way, whatever their turns. */
const quarterTurnApart = (a, b) => {
    const d = ((b - a) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
    return Math.abs(d - Math.PI / 2) < 0.03 || Math.abs(d - 3 * Math.PI / 2) < 0.03;
};

/** The perk task's record: the project's new perk named Steady Aim. */
const steadyAim = () => newRecords('SteadyAim', 'perks').find(r => /^steady aim$/i.test(nameOf(r.text)));

/** Whether a perk has an entry at ModAttackDamage, the entry point that changes the damage of the owner's attacks. */
const changesDamage = text => entriesOf(text, 'Effects').some(effect => /\bEntryPoint:[ \t]*ModAttackDamage\b/.test(effect));

/**
 * A perk's entry that changes attack damage by a multiple: its EntryPoint ModAttackDamage with a multiplication, and the
 * multiple — or undefined where it has none.
 */
function damageMultiple(text) {
    for (const effect of entriesOf(text, 'Effects')) {
        if (!/\bEntryPoint:[ \t]*ModAttackDamage\b/.test(effect) || !/\bModification:[ \t]*Multiply\b/.test(effect)) continue;
        const value = Number(/^[ \t]+Value:[ \t]*(-?[\d.]+)/m.exec(effect)?.[1] ?? NaN);
        if (Number.isFinite(value)) return value;
    }
    return undefined;
}

/** The quest task's records: the project's new quests, its Papyrus sources and the scripts its build compiled. */
function starterGold() {
    const project = 'StarterGold';
    const root = path.join(projectsDir, project);
    const quests = newRecords(project, 'quests');
    const sources = filesUnder(root).filter(f => f.toLowerCase().endsWith('.psc') && !f.includes(`${path.sep}build${path.sep}`))
        .map(f => ({ name: path.basename(f, '.psc').toLowerCase(), text: fs.readFileSync(f, 'utf8') }));
    const compiled = filesUnder(path.join(root, 'build')).filter(f => f.toLowerCase().endsWith('.pex')).map(f => path.basename(f, '.pex').toLowerCase());
    return { quests, sources, compiled };
}

/** The scripts a record's VirtualMachineAdapter attaches, by name, and the links its properties fill. */
function attachedScripts(text) {
    const adapter = blockOf(text, 'VirtualMachineAdapter');
    return {
        names: [...adapter.matchAll(/^[ \t]*-?[ \t]*Name:[ \t]*([A-Za-z_]\w*)[ \t]*\r?$/gm)].map(m => m[1].toLowerCase()),
        links: [...adapter.matchAll(/^[ \t]+Object:[ \t]*([^\s#]+)/gm)].map(m => m[1])
    };
}

/** A VirtualMachineAdapter's object properties: each Name with the Object written after it. */
function scriptProperties(text) {
    const properties = [];
    let name = null;
    for (const line of blockOf(text, 'VirtualMachineAdapter').split(/\r?\n/)) {
        const named = /^[ \t]*-?[ \t]*Name:[ \t]*(\w+)/.exec(line);
        if (named) { name = named[1]; continue; }
        const object = /^[ \t]*-?[ \t]*Object:[ \t]*([^\s#]+)/.exec(line);
        if (object && name) { properties.push({ name: name.toLowerCase(), object: object[1] }); name = null; }
    }
    return properties;
}

/**
 * The code the game runs of a quest's script: the events it sends a quest (OnInit, OnStory…; OnUpdate… once registered —
 * Quest.psc and Form.psc declare no other), its stage fragments where the quest names fragments, and the functions these
 * call. Papyrus compiles an event of any name, and one the game never sends never runs: eval round 125's quest+detailed #2
 * gave its gold in OnQuestInit. A script attached to a quest runs only if it extends Quest.
 */
function questCode(source, questText) {
    if (!/^[ \t]*ScriptName[ \t]+\w+[ \t]+extends[ \t]+Quest\b/im.test(source)) return '';
    const blocks = [...source.matchAll(/^[ \t]*(?:\w+(?:\[\])?[ \t]+)?(Event|Function)[ \t]+(\w+)[ \t]*\([^)]*\)([\s\S]*?)^[ \t]*End(?:Event|Function)\b/gim)]
        .map(m => ({ kind: m[1].toLowerCase(), name: m[2].toLowerCase(), body: m[3] }));
    const registered = /RegisterFor(?:Single)?Update(?:GameTime)?\s*\(/i.test(source);
    const fragments = /Fragment/i.test(blockOf(questText, 'VirtualMachineAdapter'));
    const reached = new Set(blocks.filter(b => b.kind === 'event'
        ? /^(oninit|onstory\w+)$/.test(b.name) || (registered && /^onupdate(gametime)?$/.test(b.name))
        : fragments && /^fragment_\d+$/.test(b.name)));
    for (let grew = true; grew;) {
        grew = false;
        for (const b of blocks) {
            if (reached.has(b) || b.kind !== 'function') continue;
            if ([...reached].some(r => new RegExp(`(^|[^\\w])${b.name}\\s*\\(`, 'i').test(r.body))) { reached.add(b); grew = true; }
        }
    }
    return [...reached].map(b => b.body).join('\n');
}

/**
 * Whether a quest's script gives the player an item the game runs it to give: an AddItem in the code the game runs (see
 * questCode), on the player, of the form by its number (Game.GetForm / GetFormFromFile, or a variable set so) or of a
 * property the script declares and the quest fills with the form. A plain variable of that name is None in game:
 * round 125's quest+detailed #5 declared `Form GoldCoins`.
 */
function givesItem(source, questText, { formId, editorId, count }) {
    const code = questCode(source, questText);
    const properties = scriptProperties(questText);
    const player = /GetPlayer\s*\(/i.test(code) ||
        (/\bPlayerRef\b/i.test(code) && /\bProperty[ \t]+PlayerRef\b/i.test(source) &&
            properties.some(p => p.name === 'playerref' && /^0*14:Skyrim\.esm$|^PlayerRef$/i.test(p.object)));
    if (!player) return false;
    const local = formId.split(':')[0].replace(/^0+/, '');
    const byNumber = new RegExp(`GetForm(?:FromFile)?\\s*\\(\\s*0x0*${local}\\b`, 'i');
    const filled = new RegExp(`^0*${local}:Skyrim\\.esm$|^${editorId}$`, 'i');
    const adds = new RegExp(`AddItem\\s*\\(\\s*([^,()]+?|[^,]*\\([^)]*\\)[^,]*?)\\s*${count ? `,\\s*${count}\\b` : '(?:,|\\))'}`, 'gi');
    for (const m of code.matchAll(adds)) {
        const argument = m[1].trim();
        if (byNumber.test(argument)) return true;
        const id = /^(?:self\.)?(\w+)$/i.exec(argument)?.[1];
        if (!id) continue;
        if (new RegExp(`\\bProperty[ \\t]+${id}\\b`, 'i').test(source) &&
            properties.some(p => p.name === id.toLowerCase() && filled.test(p.object))) return true;
        const set = new RegExp(`\\b${id}\\s*=\\s*([^\\r\\n]+)`, 'i').exec(source);
        if (set && byNumber.test(set[1])) return true;
    }
    return false;
}

/** A number at the margin as written, a comment after it YAML's, not the value's: `Value: 200 # Requested`. */
const fieldIs = (text, field, number) =>
    new RegExp(`^${field}:[ \\t]*(['"]?)${number}(?:\\.0+)?\\1(?:[ \\t]+#.*)?[ \\t]*\\r?$`, 'm').test(text ?? '');

/** Built: a build succeeded after the run's last change, and the project's build folder holds a plugin. */
const builtProject = (project, calls) =>
    builtAfterLastChange(calls, projectsDir) &&
    filesUnder(path.join(projectsDir, project, 'build')).some(f => /\.es[pml]$/i.test(f));

/** A number standing on its own: 7 in "damage 7." but not in "012EB7" or "7.5". */
const has = (text, value) => new RegExp(`(^|[^\\w.])${String(value).replace(/\./g, '\\.')}(?![\\w]|\\.\\d)`, 'i').test(text);

/** A FormID's local part however it is written: 012EB7, 00012EB7, 0x00012EB7. */
const hasFormId = (text, formId) =>
    new RegExp(`(^|[^0-9a-f])(0x)?0*${formId.split(':')[0].replace(/^0+/, '')}(?![0-9a-f])`, 'i').test(text);

/**
 * The dialogue task's records: each topic of the project — its own file in DialogTopics/<topic>/RecordData.yaml — with
 * the responses in its Responses/ folder, the project's branches and quests.
 */
function huldaDialogue() {
    const { plugin, records } = projectRecords('HuldaRumors');
    const own = r => !!plugin && !!r.formKey?.toLowerCase().endsWith(`:${plugin.toLowerCase()}`);
    const topics = records.filter(r => /^DialogTopics\/[^/]+\/RecordData\.yaml$/i.test(r.file)).map(topic => ({
        ...topic, own: own(topic),
        responses: records.filter(r => r.file.toLowerCase().startsWith(topic.file.toLowerCase().replace(/recorddata\.yaml$/, 'responses/')))
    }));
    return { plugin, topics, branches: records.filter(r => r.group === 'dialogbranches'), quests: records.filter(r => r.group === 'quests' && own(r)) };
}

/** A field's link, as written: `Branch: HuldaRumorsBranch`, its comment left out. */
const linkIn = (text, field) => new RegExp(`^${field}:[ \\t]*([^\\s#]+)`, 'm').exec(text ?? '')?.[1];

/** The lines a response says, each Text's Value. */
const saidIn = text => [...(text ?? '').matchAll(/^[ \t]+Text:[ \t]*\r?\n(?:[ \t]+.*\r?\n)*?[ \t]+Value:[ \t]*(.+?)[ \t]*\r?$/gm)]
    .map(m => m[1].replace(/^['"]|['"]$/g, ''));

/** The NPCs a response's GetIsID conditions name, as written. */
const idConditions = text => [...(text ?? '').matchAll(/MutagenObjectType:[ \t]*GetIsIDConditionData[ \t]*\r?\n(?:[ \t]+.*\r?\n)*?[ \t]+Object:[ \t]*([^\s#]+)/g)]
    .map(m => m[1]);

/** A flag of a record's own Flags list, which Spriggit writes at the margin (`- TopLevel`), or a part's, indented (hasFlag). */
const flagged = (text, flag) => new RegExp(`^[ \\t]*-[ \\t]*${flag}[ \\t]*\\r?$`, 'm').test(text ?? '') || hasFlag(text ?? '', flag);

/** The project's copy of a game record, by its FormKey: the file whose FormKey it is. */
const copyOf = (project, formId) => projectRecords(project).records.find(r => r.formKey?.toLowerCase() === formId.toLowerCase());

const TASKS = [
    {
        id: 'find',
        prompt: 'Which plugin defines the Iron Sword, and what is its FormID?',
        check: ({ answer }) => ({
            formId: hasFormId(answer, truth.ironSword.formId),
            plugin: /skyrim\.esm/i.test(answer)
        })
    },
    {
        id: 'read',
        prompt: 'How much damage does the Iron Sword do in my load order, and how much does it weigh?',
        check: ({ answer }) => ({
            damage: has(answer, truth.ironSword.damage),
            weight: has(answer, truth.ironSword.weight)
        })
    },
    {
        id: 'filter',
        prompt: 'List three pieces of armor that Dawnguard.esm adds, each with its FormID.',
        check: async ({ answer }) => {
            const ids = [...new Set([...answer.matchAll(/\b([0-9A-F]{6}):Dawnguard\.esm\b/gi)]
                .map(m => `${m[1].toUpperCase()}:Dawnguard.esm`))];
            let armor = 0;
            if (ids.length) {
                const found = await callServerJson('findRecords', { records: ids, limit: 200 });
                armor = found.records.filter(r => r.signature === 'ARMO' && r.definedIn === 'Dawnguard.esm').length;
            }
            return { threeFormIds: ids.length >= 3, allArmorFromDawnguard: ids.length >= 3 && armor === ids.length };
        }
    },
    {
        id: 'patch',
        prompt: 'Make a patch mod called IronSwordBuff that raises the Iron Sword\'s damage to 12. ' +
            'Leave everything else about the sword as it is. Do not build or deploy it yet.',
        check: () => {
            const text = recordText('IronSwordBuff', truth.ironSword.formId) ?? '';
            return {
                recordInProject: !!text,
                damage12: /^\s+Damage:\s*12\s*$/m.test(text),
                restKept: text.includes('EditorID: IronSword') &&
                    new RegExp(`^\\s+Weight:\\s*${truth.ironSword.weight}\\s*$`, 'm').test(text)
            };
        }
    },
    {
        id: 'build',
        prompt: 'Make a patch mod called SteelSwordLight in which the Steel Sword weighs 5, and build it. Do not deploy it.',
        check: ({ calls }) => {
            const text = recordText('SteelSwordLight', truth.steelSword.formId) ?? '';
            return {
                recordInProject: !!text,
                weight5: /^\s+Weight:\s*5\s*$/m.test(text),
                built: builtProject('SteelSwordLight', calls)
            };
        }
    },
    // Authoring: new records written by hand into a new project, following vanilla ones, and built.
    {
        id: 'sword',
        skill: 'skyrim-modding-items-and-crafting',
        prompt: 'Make a new mod called FlameBlade with a new one-handed sword named "Flame Blade" that has a fire ' +
            'damage enchantment, so it burns what it hits. Build it, but do not deploy it.',
        detailed: 'Make a new mod called FlameBlade with a new one-handed sword named "Flame Blade". Make it like the ' +
            'Iron Sword — its model, sounds and weapon type — but with 12 damage, a weight of 10 and a value of 150. Give ' +
            'it a new enchantment of its own, named "Flame Blade Burn", that deals 10 points of fire damage to whatever it ' +
            'hits, with a charge of 500. Build it, but do not deploy it.',
        check: async ({ calls }) => {
            const { sword, effects } = await flameBlade();
            return {
                newSword: !!sword,
                // The sword keyword by its FormID, or by its editor ID, which the build keeps in the file since round 48.
                oneHandedSword: !!sword && (/AnimationType:[ \t]*OneHandSword/.test(sword.text) || sword.text.includes('01E711:Skyrim.esm')
                    || /^[ \t]*-[ \t]*WeapTypeSword[ \t]*(?:#.*)?\r?$/m.test(sword.text)),
                // A sword the player can carry: copied from the Bound Sword, 10 of rounds 31–44 kept its
                // NonPlayable and BoundWeapon flags — a conjured weapon, kept out of the inventory — and 9 passed without this.
                playable: !!sword && !/^[ \t]+-[ \t]*(?:NonPlayable|BoundWeapon)[ \t]*\r?$|^[ \t]*Flags:[ \t]*\[[^\]\r\n]*\b(?:NonPlayable|BoundWeapon)\b/m.test(sword.text),
                fireEnchantment: effects.some(text => FIRE.test(text)),
                burnsVisibly: effects.some(text => FIRE.test(text) && BURN.test(text)),
                modelInGame: !!sword && await modelInGame('FlameBlade', sword.text),
                // Held in the player's hands in first person: 9 sword runs of rounds 87–105 passed without a FirstPersonModel.
                firstPersonModel: !!sword && !!firstPersonModelOf(sword.text),
                noOverride: noOverride('FlameBlade'),
                built: builtProject('FlameBlade', calls)
            };
        },
        // The enchantment the detailed prompt names, beside those: round 76's sword+detailed #3 made its copy of the game's
        // new and left the sword naming the game's by editor ID — the Fire Damage of 5 points — and passed, the game's
        // enchantment burning too.
        detailedCheck: async ({ calls }) => {
            const { sword, enchantment, items } = await flameBlade();
            const { plugin } = projectRecords('FlameBlade');
            // The value and charge it asks for: round 87's sword+detailed #4 kept the Iron Sword's value of 25 and wrote no
            // charge, #5 no charge, and both passed — #4 failed on its enchantment's name alone.
            const basicStats = (sword && /^BasicStats:[ \t]*\r?\n((?:[ \t]+\S.*(?:\r?\n|$))*)/m.exec(sword.text)?.[1]) ?? '';
            return {
                ...await TASKS.find(t => t.id === 'sword').check({ calls }),
                ownEnchantment: !!enchantment?.formKey && !!plugin && enchantment.formKey.toLowerCase().endsWith(`:${plugin.toLowerCase()}`),
                enchantmentNamed: !!enchantment && /^flame blade burn$/i.test(nameOf(enchantment.text)),
                // As the game deals it: round 103's sword+detailed #5 burned 10 a second for 2 s and passed on its magnitude.
                tenPoints: items.some(({ text, magnitude, duration }) => FIRE.test(text) && dealtDamage(magnitude, duration, text) === 10),
                // A comment after the number is YAML's, not the value's: round 122's sword+detailed #5 built value 150 and charge
                // 500 from `Value: 150 # Requested Price` and `EnchantmentAmount: 500 # Requested Charge`, and failed both.
                valueOf150: /^[ \t]+Value:[ \t]*(['"]?)150\1(?:[ \t]+#.*)?[ \t]*\r?$/m.test(basicStats),
                chargeOf500: !!sword && /^EnchantmentAmount:[ \t]*(['"]?)500\1(?:[ \t]+#.*)?[ \t]*\r?$/m.test(sword.text)
            };
        }
    },
    // Armor (since round 125, the user's wish): an item worn, drawn by its armor addons, with an enchantment cast for as
    // long as it is worn.
    {
        id: 'armor',
        skill: 'skyrim-modding-items-and-crafting',
        prompt: 'Make a new mod called FrostGuard with a new helmet named "Frostguard Helm" that protects its wearer ' +
            'from frost. Build it, but do not deploy it.',
        detailed: 'Make a new mod called FrostGuard with a new helmet named "Frostguard Helm". Make it like the Steel ' +
            'Helmet — its models, sounds and keywords, a heavy armor helmet — but with an armor rating of 20, a weight of 6 ' +
            'and a value of 200. Give it a new enchantment of its own, named "Frostguard Ward", that gives its wearer 30% ' +
            'frost resistance. Build it, but do not deploy it.',
        check: async ({ calls }) => {
            const { helm, addons, items } = await frostguardHelm();
            const slots = blockOf(helm?.text, 'BodyTemplate');
            return {
                newHelmet: !!helm,
                // Worn on the head: its body slots name the head or the hair, as the game's helmets do.
                onTheHead: /^[ \t]*-[ \t]*(?:Head|Hair)[ \t]*\r?$|\[[^\]\r\n]*\b(?:Head|Hair)\b/m.test(slots),
                // A helmet the player can carry and wear.
                playable: !!helm && !/^[ \t]+-[ \t]*NonPlayable[ \t]*\r?$|^[ \t]*\w*Flags:[ \t]*\[[^\]\r\n]*\bNonPlayable\b/m.test(helm.text),
                // Drawn on the ground, and on its wearer: its own model, and an armor addon whose model the game has.
                modelInGame: !!helm && await modelFileInGame('FrostGuard', fileIn(blockOf(helm.text, 'WorldModel'))),
                wornModelInGame: (await Promise.all(addons.map(text => modelFileInGame('FrostGuard', fileIn(blockOf(text, 'WorldModel'))))))
                    .some(Boolean),
                frostResistance: items.some(({ text }) => FROST_RESIST.test(text)),
                // For as long as it is worn: an effect cast otherwise does nothing on an armor.
                whileWorn: items.some(({ text }) => FROST_RESIST.test(text) && CONSTANT.test(text)),
                noOverride: noOverride('FrostGuard'),
                built: builtProject('FrostGuard', calls)
            };
        },
        // What the detailed prompt names, beside those: heavy armor, the numbers, and a new enchantment of its own.
        detailedCheck: async ({ calls }) => {
            const { helm, enchantment, items } = await frostguardHelm();
            const { plugin } = projectRecords('FrostGuard');
            return {
                ...await TASKS.find(t => t.id === 'armor').check({ calls }),
                heavyArmor: /^[ \t]+ArmorType:[ \t]*HeavyArmor[ \t]*\r?$/m.test(blockOf(helm?.text, 'BodyTemplate')),
                armorRating20: fieldIs(helm?.text, 'ArmorRating', 20),
                weightOf6: fieldIs(helm?.text, 'Weight', 6),
                valueOf200: fieldIs(helm?.text, 'Value', 200),
                ownEnchantment: !!enchantment?.formKey && !!plugin && enchantment.formKey.toLowerCase().endsWith(`:${plugin.toLowerCase()}`),
                enchantmentNamed: !!enchantment && /^frostguard ward$/i.test(nameOf(enchantment.text)),
                resist30: items.some(({ text, magnitude }) => FROST_RESIST.test(text) && magnitude === 30)
            };
        }
    },
    // A potion (since round 125): an item drunk, its effect on the drinker.
    {
        id: 'potion',
        skill: 'skyrim-modding-items-and-crafting',
        prompt: 'Make a new mod called HealingDraught with a new potion named "Healing Draught" that restores the ' +
            'drinker\'s health. Build it, but do not deploy it.',
        detailed: 'Make a new mod called HealingDraught with a new potion named "Healing Draught". Make it like the ' +
            'Potion of Minor Healing — its model and sounds — but restoring 40 points of health at once, with a value of 30 ' +
            'and a weight of 0.5. Build it, but do not deploy it.',
        check: async ({ calls }) => {
            const { potion, items } = await healingDraught();
            return {
                newPotion: !!potion,
                // Drunk as a potion: flagged neither food nor poison.
                aPotion: !!potion && !/^[ \t]*-[ \t]*(?:FoodItem|Poison)[ \t]*\r?$|Flags:[ \t]*\[[^\]\r\n]*\b(?:FoodItem|Poison)\b/m.test(potion.text),
                restoresHealth: items.some(({ text }) => HEALTH.test(text) && !DETRIMENTAL.test(text)),
                modelInGame: !!potion && await modelInGame('HealingDraught', potion.text),
                noOverride: noOverride('HealingDraught'),
                built: builtProject('HealingDraught', calls)
            };
        },
        detailedCheck: async ({ calls }) => {
            const { potion, items } = await healingDraught();
            return {
                ...await TASKS.find(t => t.id === 'potion').check({ calls }),
                restores40AtOnce: items.some(({ text, magnitude, duration }) =>
                    HEALTH.test(text) && !DETRIMENTAL.test(text) && magnitude === 40 && atOnce(duration, text)),
                valueOf30: fieldIs(potion?.text, 'Value', 30),
                weightOf05: fieldIs(potion?.text, 'Weight', '0?\\.5')
            };
        }
    },
    // A recipe (since round 125): a record that makes another, at a station, from materials, for a player with a perk.
    {
        id: 'recipe',
        skill: 'skyrim-modding-items-and-crafting',
        prompt: 'Make a new mod called NordSwordRecipe with a recipe that lets the player make the Ancient Nord Sword at ' +
            'the forge from 2 iron ingots and 1 leather strip. Build it, but do not deploy it.',
        detailed: 'Make a new mod called NordSwordRecipe with a recipe that lets the player make the Ancient Nord Sword. ' +
            'Make it like the Steel Sword\'s recipe — made at the forge, and shown only to a player with the Steel Smithing ' +
            'perk — but from 2 steel ingots and 1 leather strip. Build it, but do not deploy it.',
        check: async ({ calls }) => {
            const { recipe, at, materials } = await nordSwordRecipe();
            return {
                newRecipe: !!recipe,
                atTheForge: at?.toLowerCase() === 'craftingsmithingforge',
                ironAndLeather: materialsAre(materials, { IngotIron: 2, LeatherStrips: 1 }),
                noOverride: noOverride('NordSwordRecipe'),
                built: builtProject('NordSwordRecipe', calls)
            };
        },
        // Its own materials, steel for iron, and the perk.
        detailedCheck: async ({ calls }) => {
            const { recipe, at, materials, perks } = await nordSwordRecipe();
            return {
                newRecipe: !!recipe,
                atTheForge: at?.toLowerCase() === 'craftingsmithingforge',
                steelAndLeather: materialsAre(materials, { IngotSteel: 2, LeatherStrips: 1 }),
                // Shown only to a player with the perk: a HasPerk condition the perk meets (since round 128).
                steelSmithing: perks.some(id => id.toLowerCase() === 'steelsmithing'),
                noOverride: noOverride('NordSwordRecipe'),
                built: builtProject('NordSwordRecipe', calls)
            };
        }
    },
    // Ammunition (since round 125): arrows, and the projectile they fly as.
    {
        id: 'arrow',
        skill: 'skyrim-modding-items-and-crafting',
        prompt: 'Make a new mod called HuntersArrow with new arrows named "Hunter\'s Arrow" that do more damage than steel ' +
            'arrows. Build it, but do not deploy it.',
        detailed: 'Make a new mod called HuntersArrow with new arrows named "Hunter\'s Arrow". Make them like the Steel ' +
            'Arrow — its model, the projectile it flies as and its sounds — but with 16 damage and a value of 4. Build it, ' +
            'but do not deploy it.',
        check: async ({ calls }) => {
            const { arrow, projectile } = await huntersArrow();
            return {
                newArrow: !!arrow,
                // For a bow: flagged NonBolt, as the game's arrows are; a bolt is a crossbow's.
                anArrow: !!arrow && /^[ \t]*-[ \t]*NonBolt[ \t]*\r?$|Flags:[ \t]*\[[^\]\r\n]*\bNonBolt\b/m.test(arrow.text),
                playable: !!arrow && !/^[ \t]*-[ \t]*NonPlayable[ \t]*\r?$|Flags:[ \t]*\[[^\]\r\n]*\bNonPlayable\b/m.test(arrow.text),
                moreDamage: !!arrow && ammoDamage(arrow.text) > truth.steelArrow.damage,
                modelInGame: !!arrow && await modelInGame('HuntersArrow', arrow.text),
                // Flies as a projectile the game draws.
                projectileInGame: !!projectile && await modelInGame('HuntersArrow', projectile),
                noOverride: noOverride('HuntersArrow'),
                built: builtProject('HuntersArrow', calls)
            };
        },
        detailedCheck: async ({ calls }) => {
            const { arrow } = await huntersArrow();
            return {
                ...await TASKS.find(t => t.id === 'arrow').check({ calls }),
                damage16: ammoDamage(arrow?.text) === 16,
                valueOf4: fieldIs(arrow?.text, 'Value', 4)
            };
        }
    },
    // A shout (since round 125, the user's wish): three words of power, each casting a spell of the voice.
    {
        id: 'shout',
        skill: 'skyrim-modding-magic',
        prompt: 'Make a new mod called ThunderRoar with a new dragon shout named "Thunder Roar" that deals shock damage ' +
            'to the enemies in front of the player. Build it, but do not deploy it.',
        detailed: 'Make a new mod called ThunderRoar with a new dragon shout named "Thunder Roar". Make it like Fire ' +
            'Breath — three words, each shouted at what is in front of the player — but dealing shock damage, with three ' +
            'words of power of its own: "Kreh" (Thunder), "Dahl" (Strike) and "Vund" (Storm). The first word deals 20 ' +
            'points of shock damage, the second 40 and the third 60, and the shout recovers in 15, 30 and 45 seconds. ' +
            'Build it, but do not deploy it.',
        check: async ({ calls }) => {
            const { shout, words } = await thunderRoar();
            return {
                newShout: !!shout,
                threeWords: words.length === 3 && words.every(w => w.wordText && w.spellText),
                // Each word's spell a shout's, the voice's: a spell of another type cast from a shout does nothing.
                voiceSpells: words.length > 0 && words.every(w => /^Type:[ \t]*Voice[ \t]*\r?$/m.test(w.spellText)),
                shockDamage: words.length > 0 && words.every(w => shockDealt(w) > 0),
                noOverride: noOverride('ThunderRoar'),
                built: builtProject('ThunderRoar', calls)
            };
        },
        // The words it names, the project's own and translated, and each word's damage and recovery.
        detailedCheck: async ({ calls }) => {
            const { words } = await thunderRoar();
            const named = (got, want) => got.length === want.length && want.every((w, i) => got[i]?.toLowerCase() === w.toLowerCase());
            return {
                ...await TASKS.find(t => t.id === 'shout').check({ calls }),
                ownWords: words.length === 3 && words.every(w => w.ownWord) &&
                    named(words.map(w => nameOf(w.wordText)), ['Kreh', 'Dahl', 'Vund']),
                translated: named(words.map(w => translatedValue(w.wordText, 'Translation') ?? ''), ['Thunder', 'Strike', 'Storm']),
                damage20to60: named(words.map(w => String(shockDealt(w))), ['20', '40', '60']),
                recovery15to45: named(words.map(w => String(w.recovery)), ['15', '30', '45'])
            };
        }
    },
    // A magic effect of the mod's own (since round 125, the user's wish): the tasks before reuse the game's.
    {
        id: 'effect',
        skill: 'skyrim-modding-magic',
        prompt: 'Make a new mod called FeatherStep with a new Alteration spell named "Feather Step" that lets the caster ' +
            'carry more for a while, with a new magic effect of its own. Build it, but do not deploy it.',
        detailed: 'Make a new mod called FeatherStep with a new spell named "Feather Step" that the caster casts on ' +
            'themselves, like Oakflesh: Alteration, Novice level. Give it a new magic effect of its own, named "Feather ' +
            'Step", that raises the caster\'s carry weight by 100 for 60 seconds, after which it is what it was. Build it, ' +
            'but do not deploy it.',
        check: async ({ calls }) => {
            const { spell, own } = await featherStep();
            return {
                newSpell: !!spell,
                ownEffect: own.length > 0,
                // By something: round 128's effect #3 named its effect with `Data: {}`, a magnitude of 0 (since round 128).
                raisesCarryWeight: own.some(({ text, magnitude }) => CARRY.test(text) && !DETRIMENTAL.test(text) && magnitude > 0),
                alteration: own.some(({ text }) => /^MagicSkill:[ \t]*Alteration[ \t]*\r?$/m.test(text)),
                // For a while: the carry weight given back when the effect ends, or raised for good.
                givesItBack: own.some(({ text }) => CARRY.test(text) && RECOVER.test(text)),
                // Self, the default the serializer leaves out: the game's Oakflesh has no TargetType line.
                onTheCaster: !!spell && (!/^TargetType:/m.test(spell.text) || /^TargetType:[ \t]*Self[ \t]*\r?$/m.test(spell.text)),
                noOverride: noOverride('FeatherStep'),
                built: builtProject('FeatherStep', calls)
            };
        },
        detailedCheck: async ({ calls }) => {
            const { own } = await featherStep();
            return {
                ...await TASKS.find(t => t.id === 'effect').check({ calls }),
                effectNamed: own.some(({ text }) => /^feather step$/i.test(nameOf(text))),
                by100For60s: own.some(({ text, magnitude, duration }) => CARRY.test(text) && magnitude === 100 && duration === 60)
            };
        }
    },
    // A leveled list (since round 125, the user's pick): a game list changed in a copy, keeping what it holds — the edit
    // two mods of one list conflict on.
    {
        id: 'leveled',
        skill: 'skyrim-modding-leveled-lists',
        prompt: 'Make a new mod called BanditSilver in which bandits can also carry silver swords. Build it, but do not ' +
            'deploy it.',
        detailed: 'Make a new mod called BanditSilver in which bandits can also carry the Silver Sword: add it, at level 1, ' +
            'to the leveled list the bandits\' one-handed weapons come from, keeping everything that list already holds. ' +
            'Build it, but do not deploy it.',
        check: async ({ calls }) => {
            const lists = await banditLists();
            const silver = lists.filter(list => list.silver.length > 0);
            return {
                banditListChanged: silver.length > 0,
                // Added to, not replaced: every entry the game's list has is in the copy.
                keepsItsEntries: silver.length > 0 && silver.every(list => keepsEntries(list.entries, list.theirs)),
                built: builtProject('BanditSilver', calls)
            };
        },
        detailedCheck: async ({ calls }) => {
            const lists = await banditLists();
            return {
                ...await TASKS.find(t => t.id === 'leveled').check({ calls }),
                atLevel1: lists.some(list => list.silver.includes(1)),
                aOneHandedList: lists.some(list => /1H|OneHand/i.test(/^EditorID:[ \t]*(\S+)/m.exec(list.text)?.[1] ?? '')
                    && list.silver.length > 0)
            };
        }
    },
    // Placed in the world (since round 125, the user's pick): a chest in a game cell, holding things.
    {
        id: 'world',
        skill: 'skyrim-modding-world',
        prompt: 'Make a new mod called BreezehomeChest that puts a chest in Breezehome holding 500 gold and a Steel Sword. ' +
            'Build it, but do not deploy it.',
        detailed: 'Make a new mod called BreezehomeChest that puts a new chest of its own, named "Hunter\'s Chest", in ' +
            'Breezehome\'s main room. Make it like the chests of the player\'s houses, whose contents never respawn, holding ' +
            '500 gold, a Steel Sword and 10 Steel Arrows. Build it, but do not deploy it.',
        check: async ({ calls }) => {
            const chests = await breezehomeChests();
            const filled = chests.filter(chest => holds(chest, 'Gold001') === 500 && holds(chest, truth.steelSword.editorId) === 1);
            return {
                chestInBreezehome: chests.length > 0,
                // Where the player finds it: in the house, on a floor (since round 128).
                inTheHouse: chests.some(chest => inTheHouse(chest.position)),
                holdsGoldAndSword: filled.length > 0,
                built: builtProject('BreezehomeChest', calls)
            };
        },
        detailedCheck: async ({ calls }) => {
            const chests = (await breezehomeChests()).filter(chest => chest.own && /^hunter'?s chest$/i.test(nameOf(chest.text)));
            return {
                ...await TASKS.find(t => t.id === 'world').check({ calls }),
                ownChestNamed: chests.length > 0,
                tenSteelArrows: chests.some(chest => holds(chest, 'SteelArrow') === 10),
                // A house chest keeps what the player puts in: one flagged Respawns empties itself and fills up again.
                neverRespawns: chests.length > 0 && chests.every(chest => !/^[ \t]*-[ \t]*Respawns[ \t]*\r?$|Flags:[ \t]*\[[^\]\r\n]*\bRespawns\b/m.test(chest.text))
            };
        }
    },
    // Placed outdoors (since round 133): a chest in an exterior cell of Tamriel, beside a thing the game places there.
    {
        id: 'outdoor',
        skill: 'skyrim-modding-world',
        prompt: 'Make a new mod called RiverwoodSmithChest that puts a chest holding 100 gold outdoors in Riverwood, next to ' +
            'the grindstone at Alvor\'s smithy. Build it, but do not deploy it.',
        detailed: 'Make a new mod called RiverwoodSmithChest that puts a new chest of its own, named "Smith\'s Chest", outdoors ' +
            'in Riverwood, standing on the ground right beside the grindstone at Alvor\'s smithy. It never respawns, and holds ' +
            '100 gold and 5 Iron Ingots. Build it, but do not deploy it.',
        check: async ({ calls }) => {
            const chests = await outdoorChests('RiverwoodSmithChest');
            const at = truth.grindstone.position;
            // Beside it, not in it: a chest built at the grindstone's own position stands inside it in game (the build warns of
            // that since core v0.2.61), and the outdoor task's third mini-round passed one.
            const beside = chests.filter(chest => within(chest.position, at, 400) && !within(chest.position, at, 16));
            return {
                chestOutdoors: chests.length > 0,
                besideTheGrindstone: beside.length > 0,
                // In the exterior cell its position lies in: the game loads it with the ground it stands on.
                inItsCell: beside.some(inItsGrid),
                // On the ground there, not sunk into it or floating: the ground rises and falls outdoors.
                onTheGround: beside.some(chest => Math.abs(chest.position[2] - at[2]) <= 120),
                holds100Gold: chests.some(chest => holds(chest, 'Gold001') === 100),
                built: builtProject('RiverwoodSmithChest', calls)
            };
        },
        detailedCheck: async ({ calls }) => {
            const chests = (await outdoorChests('RiverwoodSmithChest')).filter(chest => chest.own && /^smith'?s chest$/i.test(nameOf(chest.text)));
            return {
                ...await TASKS.find(t => t.id === 'outdoor').check({ calls }),
                ownChestNamed: chests.length > 0,
                fiveIronIngots: chests.some(chest => holds(chest, 'IngotIron') === 5),
                neverRespawns: chests.length > 0 && chests.every(chest => !/^[ \t]*-[ \t]*Respawns[ \t]*\r?$|Flags:[ \t]*\[[^\]\r\n]*\bRespawns\b/m.test(chest.text))
            };
        }
    },
    // A cell arranged in Blender (since round 133, with --blender): through Blender's MCP server, brought back with importCell.
    {
        id: 'blender',
        skill: 'skyrim-modding-world',
        blender: true,
        prompt: 'Make a new mod called StablesStrongbox: open Whiterun Stables in Blender, move its strongbox 100 units east ' +
            '(+x), and put a copy of the strongbox 64 units north (+y) of where the moved one stands. Bring the changes back ' +
            'into the mod. Build it, but do not deploy it.',
        detailed: 'Make a new mod called StablesStrongbox. Use Blender: export the Whiterun Stables cell to it, and there move ' +
            'the Thieves Guild strongbox (TGRStrongbox) 100 units along +x and turn it a quarter turn about its vertical axis; ' +
            'then copy it, and place the copy 64 units along +y from the moved one, turned the same way. Bring the layout back ' +
            'into the mod with the tools. Build it, but do not deploy it.',
        check: async ({ calls }) => {
            const { copy, added } = stablesStrongboxes('StablesStrongbox');
            const [x, y, z] = truth.strongbox.position;
            const moved = copy ? positionOf(copy.text) : undefined;
            const near = (p, q, reach) => !!p && Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) <= reach;
            return {
                usedBlender: blenderCalls(calls).length > 0,
                exportedAndImported: calls.some(c => c.name === 'exportCell') && calls.some(c => c.name === 'importCell'),
                movedEast: near(moved, [x + 100, y, z], 8),
                copyNorthOfIt: added.some(r => near(positionOf(r.text), [x + 100, y + 64, z], 16)),
                built: builtProject('StablesStrongbox', calls)
            };
        },
        detailedCheck: async ({ calls }) => {
            const { copy, added } = stablesStrongboxes('StablesStrongbox');
            const turned = truth.strongbox.rotation[2];
            return {
                ...await TASKS.find(t => t.id === 'blender').check({ calls }),
                movedTurned: !!copy && quarterTurnApart(turned, rotationOf(copy.text)[2]),
                copyTurned: added.some(r => quarterTurnApart(turned, rotationOf(r.text)[2]))
            };
        }
    },
    // A perk (since round 125, the user's pick): an entry point that changes a value, under conditions.
    {
        id: 'perk',
        skill: 'skyrim-modding-perks',
        prompt: 'Make a new mod called SteadyAim with a new perk named "Steady Aim" that makes the player\'s bows deal 20% ' +
            'more damage. Build it, but do not deploy it.',
        detailed: 'Make a new mod called SteadyAim with a new perk named "Steady Aim". Make it like the first rank of ' +
            'Overdraw — it changes the damage of attacks with a bow — but the player\'s bows deal 30% more damage, and only ' +
            'while the player is sneaking. It requires an Archery skill of 30. Build it, but do not deploy it.',
        check: async ({ calls }) => {
            const perk = steadyAim();
            return {
                newPerk: !!perk,
                playable: !!perk && !/^Playable:[ \t]*false/mi.test(perk.text),
                changesAttackDamage: !!perk && changesDamage(perk.text),
                by20Percent: Math.abs((damageMultiple(perk?.text) ?? 0) - 1.2) < 1e-6,
                // With a bow, as Overdraw: its entry's condition names the bow's keyword or type.
                withBows: !!perk && /WeapTypeBow|\b0001E715\b|01E715:Skyrim\.esm|EquippedItemType|Bow\b/.test(blockOf(perk.text, 'Effects')),
                noOverride: noOverride('SteadyAim'),
                built: builtProject('SteadyAim', calls)
            };
        },
        detailedCheck: async ({ calls }) => {
            const perk = steadyAim();
            const { by20Percent, ...rest } = await TASKS.find(t => t.id === 'perk').check({ calls });
            void by20Percent;
            return {
                ...rest,
                by30Percent: Math.abs((damageMultiple(perk?.text) ?? 0) - 1.3) < 1e-6,
                whileSneaking: !!perk && /IsSneaking/.test(blockOf(perk.text, 'Effects')),
                // Archery 30 needed: the perk's own conditions ask the player's Archery (Marksman) skill for 30.
                archery30: !!perk && /Marksman|Archery/.test(blockOf(perk.text, 'Conditions')) &&
                    /^[ \t]+ComparisonValue:[ \t]*30(?:\.0+)?[ \t]*\r?$/m.test(blockOf(perk.text, 'Conditions'))
            };
        }
    },
    // A quest with a Papyrus script (since round 125, the user's pick): started with the game, its script compiled by the build.
    {
        id: 'quest',
        skill: 'skyrim-modding-quests-and-scripts',
        prompt: 'Make a new mod called StarterGold that gives the player 500 gold when a new game starts. Build it, but do ' +
            'not deploy it.',
        detailed: 'Make a new mod called StarterGold with a quest of its own named "Starter Gold" that starts with the ' +
            'game and runs once: its script gives the player 500 gold and a Steel Sword when the quest starts, then stops ' +
            'the quest. Build it, but do not deploy it.',
        check: async ({ calls }) => {
            const { quests, sources, compiled } = starterGold();
            const scripted = quests.map(q => ({ quest: q, scripts: attachedScripts(q.text) }))
                .filter(q => q.scripts.names.some(name => sources.some(s => s.name === name)));
            const source = name => sources.find(s => s.name === name)?.text ?? '';
            return {
                newQuest: quests.length > 0,
                startsWithGame: quests.some(q => /^[ \t]*-[ \t]*StartGameEnabled[ \t]*\r?$|Flags:[ \t]*\[[^\]\r\n]*\bStartGameEnabled\b/m.test(q.text)),
                scriptAttached: scripted.length > 0,
                scriptCompiled: scripted.some(q => q.scripts.names.some(name => compiled.includes(name))),
                // 500 gold to the player, the game's (Gold001, 00000F), in code the game runs (see givesItem).
                gives500Gold: scripted.some(q => q.scripts.names.some(name =>
                    givesItem(source(name), q.quest.text, { formId: '00000F:Skyrim.esm', editorId: 'Gold001', count: 500 }))),
                noOverride: noOverride('StarterGold'),
                built: builtProject('StarterGold', calls)
            };
        },
        detailedCheck: async ({ calls }) => {
            const { quests, sources } = starterGold();
            // Each attached script with its quest, as the game runs them.
            const pairs = quests.flatMap(q => attachedScripts(q.text).names
                .map(name => ({ quest: q.text, source: sources.find(s => s.name === name)?.text }))
                .filter(p => p.source));
            return {
                ...await TASKS.find(t => t.id === 'quest').check({ calls }),
                questNamed: quests.some(q => /^starter gold$/i.test(nameOf(q.text))),
                runsOnce: quests.some(q => /^[ \t]*-[ \t]*RunOnce[ \t]*\r?$|Flags:[ \t]*\[[^\]\r\n]*\bRunOnce\b/m.test(q.text)),
                givesSteelSword: pairs.some(p => givesItem(p.source, p.quest, { formId: '013989:Skyrim.esm', editorId: 'SteelSword' })),
                stopsTheQuest: pairs.some(p => /(^|[^\w.]|\bself\.)Stop\s*\(\s*\)/i.test(questCode(p.source, p.quest)))
            };
        }
    },
    // Dialogue (since 2026-11-07, the user's "go on with these"): a line the player asks an NPC, and her answer.
    {
        id: 'dialogue',
        skill: 'skyrim-modding-quests-and-scripts',
        prompt: 'Make a new mod called HuldaRumors in which the player can ask Hulda, who runs the Bannered Mare in Whiterun, ' +
            '"Heard any rumors lately?", and she answers "They say a dragon was seen over Helgen." Build it, but do not deploy it.',
        detailed: 'Make a new mod called HuldaRumors with a quest of its own, named "Hulda\'s Rumors", that starts with the game. ' +
            'In it, a top-level branch of the player\'s dialogue starts the topic "Heard any rumors lately?", and its response, ' +
            'given to Hulda alone — the innkeeper of the Bannered Mare in Whiterun — says "They say a dragon was seen over ' +
            'Helgen." Build it, but do not deploy it.',
        check: async ({ calls }) => {
            const { topics, branches, quests } = huldaDialogue();
            const topic = topics.find(t => t.own && /rumou?rs/i.test(nameOf(t.text)));
            const answers = (topic?.responses ?? []).filter(r => saidIn(r.text).some(line => /dragon was seen over Helgen/i.test(line)));
            const forHulda = [];
            for (const answer of answers)
                for (const npc of idConditions(answer.text))
                    if ((await linkTarget('HuldaRumors', npc))?.toLowerCase() === truth.hulda.toLowerCase()) forHulda.push(answer);
            // The player is offered it: a top-level branch whose first topic it is.
            // No topic, no branch: round 135's dialogue #4 and #5 wrote none, and a branch file with no FormKey line matched the
            // topic's missing one, the check throwing on it.
            const branchKey = topic && await linkTarget('HuldaRumors', linkIn(topic.text, 'Branch'));
            const branch = branchKey ? branches.find(b => b.formKey?.toLowerCase() === branchKey.toLowerCase()) : undefined;
            const starts = !!branch && (await linkTarget('HuldaRumors', linkIn(branch.text, 'StartingTopic')))?.toLowerCase() === topic?.formKey?.toLowerCase();
            // Its quest runs: one of the project's started with the game, or a game quest that is.
            const questKey = topic && await linkTarget('HuldaRumors', linkIn(topic.text, 'Quest'));
            const ownQuest = questKey ? quests.find(q => q.formKey?.toLowerCase() === questKey.toLowerCase()) : undefined;
            let questRuns = !!ownQuest && flagged(ownQuest.text, 'StartGameEnabled');
            if (!ownQuest && questKey) {
                try {
                    questRuns = flagged((await callServerJson('readRecord', { record: questKey })).versions[0].files.map(f => f.text).join('\n'), 'StartGameEnabled');
                } catch { /* no such quest */ }
            }
            return {
                newTopic: !!topic,
                herAnswer: answers.length > 0,
                onlyHulda: forHulda.length > 0,
                playerOffered: !!branch && flagged(branch.text, 'TopLevel') && !!starts,
                questRuns,
                built: builtProject('HuldaRumors', calls)
            };
        },
        detailedCheck: async ({ calls }) => {
            const { quests } = huldaDialogue();
            return {
                ...await TASKS.find(t => t.id === 'dialogue').check({ calls }),
                questNamed: quests.some(q => /^hulda'?s rumou?rs$/i.test(nameOf(q.text))),
                // The game offers a start-game-enabled quest's dialogue only where the plugin's SEQ file names it.
                seqFile: filesUnder(path.join(projectsDir, 'HuldaRumors', 'build')).some(f => /[\\/]seq[\\/]HuldaRumors\.seq$/i.test(f))
            };
        }
    },
    // A game setting (since 2026-11-07): how high the player jumps.
    {
        id: 'setting',
        skill: 'skyrim-modding-settings',
        prompt: 'Make a new mod called HigherJump in which the player jumps twice as high as in the game. Build it, but do not deploy it.',
        detailed: 'Make a new mod called HigherJump that changes the game setting fJumpHeightMin, how high the player jumps, from ' +
            'the game\'s 76 to 152. Build it, but do not deploy it.',
        check: async ({ calls }) => {
            const copy = copyOf('HigherJump', truth.jump.formId);
            return {
                jumpSetting: !!copy,
                twiceAsHigh: !!copy && fieldIs(copy.text, 'Data', truth.jump.value * 2),
                aFloat: !!copy && /^MutagenObjectType:[ \t]*GameSettingFloat[ \t]*\r?$/m.test(copy.text),
                built: builtProject('HigherJump', calls)
            };
        }
    },
    // A keyword (since 2026-11-07): what an item counts as — silver's extra damage to undead.
    {
        id: 'keyword',
        skill: 'skyrim-modding-settings',
        prompt: 'Make a new mod called SilverIron in which the Iron Sword counts as a silver weapon, so it deals silver\'s extra ' +
            'damage to the undead. Build it, but do not deploy it.',
        detailed: 'Make a new mod called SilverIron that gives the game\'s Iron Sword the keyword WeapMaterialSilver, keeping every ' +
            'keyword it has, so the player\'s SilverPerk adds its damage against undead, ghosts and werewolves. Build it, but do not deploy it.',
        check: async ({ calls }) => {
            const copy = copyOf('SilverIron', truth.ironSword.formId);
            const keywords = copy ? await Promise.all(listOf(copy.text, 'Keywords').map(async k => (await linkTarget('SilverIron', k))?.toLowerCase())) : [];
            return {
                ironSwordCopy: !!copy,
                silverKeyword: keywords.includes(truth.silver),
                keepsItsKeywords: !!copy && truth.ironSwordKeywords.every(k => keywords.includes(k)),
                noNewWeapon: newRecords('SilverIron', 'weapons').length === 0,
                built: builtProject('SilverIron', calls)
            };
        }
    },
    // A record conflict (since 2026-11-07, "mod conflicts should get some love"): the test instance's DLCs, settled by a patch.
    {
        id: 'conflict',
        skill: 'skyrim-modding-conflicts',
        prompt: 'In my game, one plugin\'s changes to the location Deep Folk Crossing are lost to another plugin\'s. Find out ' +
            'which, and make a new mod called ConflictPatch that keeps every plugin\'s changes to it. Build it, but do not deploy it.',
        detailed: 'In my game, Dragonborn.esm\'s version of the location Deep Folk Crossing (DeepFolkCrossingLocation) wins, and ' +
            'the keywords and the cell Dawnguard.esm gives it are lost. Make a new mod called ConflictPatch with a patch of that ' +
            'location that keeps Dragonborn\'s version and puts Dawnguard\'s keywords and cell back. Build it, but do not deploy it.',
        check: async ({ calls, answer }) => {
            const copy = copyOf('ConflictPatch', truth.deepFolk.formId);
            const keywords = copy ? await Promise.all(listOf(copy.text, 'Keywords').map(async k => (await linkTarget('ConflictPatch', k))?.toLowerCase())) : [];
            const cells = copy ? [...blockOf(copy.text, 'WorldspaceCellsAdded').matchAll(/^[ \t]*-[ \t]*['"]?(-?\d+),[ \t]*(-?\d+)/gm)].map(m => `${m[1]},${m[2]}`) : [];
            return {
                locationPatched: !!copy,
                dawnguardKeywords: truth.deepFolk.keywords.every(k => keywords.includes(k)),
                dawnguardCell: truth.deepFolk.cells.every(c => cells.includes(c)),
                namesDawnguard: /dawnguard/i.test(answer ?? ''),
                built: builtProject('ConflictPatch', calls)
            };
        },
        // The detailed prompt names the plugins itself.
        detailedCheck: async run => {
            const { namesDawnguard, ...checks } = await TASKS.find(t => t.id === 'conflict').check(run);
            return checks;
        }
    },
    {
        id: 'spell',
        skill: 'skyrim-modding-magic',
        prompt: 'Make a new mod called StormBolt with a new Destruction spell named "Storm Bolt" that deals shock ' +
            'damage to a target. Build it, but do not deploy it.',
        detailed: 'Make a new mod called StormBolt with a new Destruction spell named "Storm Bolt": an Apprentice-level, ' +
            'fire-and-forget bolt aimed at the target, like Lightning Bolt, that deals 40 points of shock damage and costs ' +
            '60 magicka. No spell tome is needed. Build it, but do not deploy it.',
        check: async ({ calls }) => {
            const spell = newRecords('StormBolt', 'spells').find(r => /^storm bolt$/i.test(nameOf(r.text)));
            const effects = spell ? await effectTexts('StormBolt', spell.text) : [];
            return {
                newSpell: !!spell,
                destruction: effects.some(text => /^MagicSkill:[ \t]*Destruction[ \t]*\r?$/m.test(text)),
                shock: effects.some(text => /^ResistValue:[ \t]*ResistShock[ \t]*\r?$/m.test(text)),
                noOverride: noOverride('StormBolt'),
                built: builtProject('StormBolt', calls)
            };
        }
    },
    {
        id: 'npc',
        skill: 'skyrim-modding-npcs',
        prompt: 'Make a new mod called HildaTheNord with one new NPC: a female Nord named "Hilda". Build it, but do ' +
            'not deploy it.',
        detailed: 'Make a new mod called HildaTheNord with one new NPC: a woman of the Nord race named "Hilda", a ' +
            'one-handed warrior with a Nord woman\'s voice, whose level follows the player\'s between 5 and 30, dressed in ' +
            'iron armor. Build it, but do not deploy it.',
        check: async ({ calls }) => {
            const npc = newRecords('HildaTheNord', 'npcs').find(r => /^hilda$/i.test(nameOf(r.text)));
            const traits = npc ? await npcTraits('HildaTheNord', npc.text) : [];
            return {
                newNpc: !!npc,
                nord: traits.length > 0 && traits.every(t => t.race?.toLowerCase() === truth.nordRace.toLowerCase()),
                female: traits.length > 0 && traits.every(t => t.female),
                noOverride: noOverride('HildaTheNord'),
                built: builtProject('HildaTheNord', calls)
            };
        },
        // What the detailed prompt adds, beside those: round 103's npc+detailed #1 and #5 wrote CalcMinLevel 5 and
        // CalcMaxLevel 30 with no Level line — a fixed level of 0 — answered that her level follows the player's, and passed.
        detailedCheck: async ({ calls }) => {
            const project = 'HildaTheNord';
            const text = newRecords(project, 'npcs').find(r => /^hilda$/i.test(nameOf(r.text)))?.text ?? '';
            const link = field => new RegExp(`^${field}:[ \\t]*([^\\s#]+)`, 'm').exec(text)?.[1];
            // Iron armor as she wears it: her outfit — named so, or holding iron armor or a list of it — or her inventory.
            const outfit = link('DefaultOutfit');
            const outfitText = outfit ? await recordAnywhere(project, outfit) : '';
            const outfitItems = [...(/^Items:[ \t]*\r?\n((?:[ \t]*-.*\r?\n?)*)/m.exec(outfitText)?.[1] ?? '').matchAll(/-[ \t]*([^\s#]+)/g)].map(m => m[1]);
            const inventory = [...text.matchAll(/^[ \t]+Item:[ \t]*([^\s#{]+)/gm)].map(m => m[1]);
            const worn = await Promise.all([outfit, ...outfitItems, ...inventory].filter(Boolean).map(l => editorIdOf(project, l)));
            return {
                ...await TASKS.find(t => t.id === 'npc').check({ calls }),
                levelFollowsPlayer: levelFollowsPlayer(text, 5, 30),
                nordWomanVoice: (await linkTarget(project, link('Voice')))?.toLowerCase() === truth.femaleNordVoice.toLowerCase(),
                // A class of the one-handed: CombatWarrior1H, GuardOrc1H, Vigilant1hMeleeClass.
                oneHandedWarrior: /1H|OneHand/i.test(await editorIdOf(project, link('Class')) ?? ''),
                ironArmor: worn.some(id => /ArmorIron/i.test(id ?? ''))
            };
        }
    },
    // Reading: a vanilla record's text copied exactly, its quotes and line breaks included.
    {
        id: 'note',
        skill: 'skyrim-modding-items-and-crafting',
        prompt: 'Make a new mod called MavenNote with a new note named "Maven\'s Warning" whose text is exactly the ' +
            'text of the note "Note From Maven". Build it, but do not deploy it.',
        detailed: 'Make a new mod called MavenNote with a new note named "Maven\'s Warning". Make it like Maven\'s ' +
            'note "Note From Maven" — the same model, sounds and keywords — with exactly the same text, word for word ' +
            'and with its formatting. Build it, but do not deploy it.',
        check: async ({ calls }) => {
            const note = newRecords('MavenNote', 'books')
                .find(r => translatedValue(r.text, 'Name')?.toLowerCase() === "maven's warning");
            return {
                newNote: !!note,
                textCopied: !!note && translatedValue(note.text, 'BookText') === truth.mavenNote.text,
                // Round 98's note #3 built on Clutter\Books\NotePlaceholder.nif, which the game does not have.
                modelInGame: !!note && await modelInGame('MavenNote', note.text),
                noOverride: noOverride('MavenNote'),
                built: builtProject('MavenNote', calls),
                // Recorded, not scored (the user, 2026-11-04): whether the copy has the note's lines and empty lines. In
                // game a copy without its empty lines runs its parts together — 170 of 357 copies of rounds 87–123,
                // read with two blank lines for each empty line, wrote one.
                ...(note ? { facts: { emptyLinesKept: lineShape(textValue(note.text, 'BookText') ?? '') === truth.mavenNote.shape } } : {})
            };
        }
    },
    // Crash logs: crashes made on purpose in the test instance (2026-10-30), whose cause is known.
    crashTask({
        id: 'crash-dll',
        prompt: 'My game crashed right after I started it. Why did it crash, and what should I do about it?',
        log: 'crash-2026-10-30-06-13-38.log',
        mod: 'Lantern Glow Tweaks',
        named: /lantern ?glow/i
    }),
    crashTask({
        id: 'crash-mesh',
        prompt: 'Skyrim crashes to the desktop every time I start it, before the main menu even shows up. What is wrong?',
        log: 'crash-2026-10-30-06-24-26.log',
        mod: 'Elder Banner Main Menu',
        named: /elder banner|logo\.nif/i
    }),
    // A Papyrus log (since 2026-11-08, the user's "provoke them"): the test instance's own, written with two test mods —
    // PapyrusNoneFlood's quest calling AddItem on a property nothing fills each second, PapyrusGoneScript's naming a script
    // no file has.
    papyrusTask({
        id: 'papyrus-flood',
        prompt: 'My Papyrus log is full of errors and my game feels sluggish. Which script causes them, and what is wrong with it?',
        log: 'game-none-flood.log',
        checks: answer => ({
            rightScript: /PNF_QuestScript/i.test(answer),
            // A call on a property nothing filled: the log's "Cannot call AddItem() on a None object".
            rightCause: /\bNone\b|not (?:been )?(?:set|filled)|unfilled|empty|no value|nothing (?:in|filled)/i.test(answer)
        })
    }),
    // The same save loaded with PapyrusNoneFlood removed: its script's data left in the save, which the game drops.
    papyrusTask({
        id: 'papyrus-history',
        prompt: 'I removed a mod in the middle of my playthrough, and now my Papyrus log shows errors when I load my save. ' +
            'Is my save broken? What do the errors mean?',
        log: 'game-save-history.log',
        checks: answer => ({
            rightScript: /PNF_QuestScript/i.test(answer),
            // What the save still holds of the removed mod, and that the game drops it: usually harmless.
            savesHistory: /\bsave/i.test(answer) && /remov|uninstall|no longer|left ?over|orphan|leftover/i.test(answer),
            notBroken: /harmless|safe|not (?:broken|corrupt|a (?:serious )?problem)|nothing to (?:fix|worry)|ignor|usually fine|generally fine|no harm/i.test(answer)
        })
    })
];

// The coverage tasks (eval-coverage.mjs, since 2026-11-08) and the LOOT task, run with --group coverage: eval.mjs's readers
// of the project's files and its checks handed over.
TASKS.push(...coverageTasks({
    callServerJson, newRecords, projectRecords, nameOf, fieldIs, flagged, listOf, blockOf, entriesOf, linkTarget, editorIdOf,
    recordAnywhere, effectItems, modelInGame, noOverride, builtProject, containerItems, leveledEntries, keepsEntries, positionOf,
    projectsDir: () => projectsDir, truth
}), lootTask());

/**
 * "Check my load order with LOOT" (since 2026-11-08): sortPlugins' preview, its word on the setup told, nothing written. The
 * test instance's order is LOOT's already, and LOOT lists most of its Creation Club plugins as dirty. A run that applies
 * the sort fails, and the profile's plugin lists are put back after every run, as they were before it.
 */
function lootTask() {
    let saved = [];
    const listFiles = () => {
        const dir = settings.env.SKYRIM_MO2_INSTANCE;
        if (!dir || !fs.existsSync(path.join(dir, 'ModOrganizer.ini'))) return [];
        const profile = /^selected_profile=(?:@ByteArray\()?([^)\r\n]+)\)?/m.exec(fs.readFileSync(path.join(dir, 'ModOrganizer.ini'), 'latin1'))?.[1] ?? 'Default';
        return ['plugins.txt', 'loadorder.txt'].map(file => path.join(dir, 'profiles', profile, file)).filter(file => fs.existsSync(file));
    };
    return {
        id: 'loot',
        group: 'coverage',
        skill: 'skyrim-modding-conflicts',
        prompt: 'Check my load order with LOOT: would it move any plugin, and does LOOT warn about anything? Do not change anything.',
        before: async () => { saved = listFiles().map(file => [file, fs.readFileSync(file)]); },
        after: async () => {
            for (const [file, bytes] of saved) if (!fs.readFileSync(file).equals(bytes)) fs.writeFileSync(file, bytes);
        },
        check: async ({ answer, calls }) => ({
            sortedWithLoot: calls.some(c => c.name === 'sortPlugins' && !c.isError),
            nothingApplied: !calls.some(c => c.name === 'sortPlugins' && c.args?.apply === true) && !calls.some(c => NOT_ALLOWED.includes(c.name)),
            saysInOrder: /already|no (?:plugins?|changes?|moves?)\b|nothing (?:to|would) move|(?:is|are) (?:sorted|in (?:the )?(?:right|correct|LOOT'?s) order)|need(?:s)? no/i.test(answer ?? ''),
            namesDirty: /dirty|clean(?:ing|ed)?\b|\bITM|deleted references?/i.test(answer ?? '')
        })
    };
}

/**
 * A "my Papyrus log" task: the log is the only one in the run's Papyrus log folder, as Papyrus.0.log. Passed when the
 * answer, after readPapyrusLog, names the script and says what its lines mean, and the run changed nothing — the tools that
 * would are denied, so trying is enough.
 */
function papyrusTask({ id, prompt, log, checks }) {
    return {
        id,
        skill: 'skyrim-modding-crash-analysis',
        prompt,
        before: async () => {
            for (const entry of fs.readdirSync(papyrusLogDir)) fs.rmSync(path.join(papyrusLogDir, entry), { force: true });
            fs.copyFileSync(path.join(root, 'scripts', 'eval-papyrus-logs', log), path.join(papyrusLogDir, 'Papyrus.0.log'));
        },
        check: async ({ answer, calls }) => ({
            readTheLog: calls.some(c => c.name === 'readPapyrusLog' && !c.isError),
            ...checks(answer ?? ''),
            nothingChanged: !calls.some(c => NOT_ALLOWED.includes(c.name))
        })
    };
}

/**
 * Crash Logger SSE's name for a log written at `time`, local time as the game has it, and its CRASH TIME line's.
 * `crash-2026-10-30-06-13-38.log`, `2026-10-30 06:13:38`.
 */
function crashLogTime(time) {
    const two = n => String(n).padStart(2, '0');
    const day = `${time.getFullYear()}-${two(time.getMonth() + 1)}-${two(time.getDate())}`;
    const clock = [time.getHours(), time.getMinutes(), time.getSeconds()].map(two);
    return { name: `crash-${day}-${clock.join('-')}.log`, line: `${day} ${clock.join(':')}` };
}

/**
 * A "my game crashed" task. Its log — a crash made on purpose: an SKSE plugin writing through a null pointer, a logo
 * mesh linking a shader property as a child — is the only one in the run's crash-log folder, and its mod is enabled,
 * as it was when the game crashed; afterwards the mod is disabled again. Passed when the answer names the mod and a
 * fix for it, after reading the log, and the run changed nothing: the tools that would are denied, so trying is enough.
 *
 * The log is put there as written just before the run, its name and CRASH TIME 30 seconds before (that day's midnight
 * at the latest): the task says the game just crashed, and a model asks for the log of the day or the minute it reads
 * in its prompt. Under its own date, 2026-10-30, four to six crash runs a round asked for a log of the round's day,
 * were refused and read the newest next (rounds 90–99).
 */
function crashTask({ id, prompt, log, mod, named }) {
    /** Every mod's state and its plugins', as the mod manager has them. */
    const modsState = async () => JSON.stringify((await callServerJson('listMods', { details: true, limit: 5000 })).mods
        .map(m => [m.name, m.enabled, (m.plugins ?? []).map(p => [p.name, p.active])]));
    let before = '';
    return {
        id,
        skill: 'skyrim-modding-crash-analysis',
        prompt,
        before: async () => {
            for (const entry of fs.readdirSync(crashLogDir)) fs.rmSync(path.join(crashLogDir, entry), { force: true });
            const now = new Date();
            const crashed = new Date(Math.max(now.getTime() - 30_000, new Date(now).setHours(0, 0, 0, 0)));
            const { name, line } = crashLogTime(crashed);
            const text = fs.readFileSync(path.join(root, 'scripts', 'eval-crash-logs', log), 'utf8');
            fs.writeFileSync(path.join(crashLogDir, name), text.replace(/^CRASH TIME: .*$/m, `CRASH TIME: ${line}`));
            fs.utimesSync(path.join(crashLogDir, name), crashed, crashed);
            await callServerJson('enableMod', { mod });
            before = await modsState();
        },
        after: async () => {
            await callServerJson('disableMod', { mod }).catch(error => console.error(`could not disable ${mod} again: ${error.message}`));
        },
        check: async ({ answer, calls }) => ({
            readTheLog: calls.some(c => c.name === 'readCrashLog' && !c.isError),
            rightMod: named.test(answer),
            // A mod downloaded again replaces its files, as a reinstall does: eval round 104's crash-mesh #2 advised to
            // "re-download that mod". A mod brought up to date is updated: round 118's crash-dll #5 advised to "make sure this
            // mod is … fully up-to-date" and supports the game's version.
            rightFix: /\b(disabl|remov|uninstall|reinstall|re-?download|updat|up[- ]to[- ]date|replac|turn(?:ed|ing)? off)/i.test(answer),
            nothingChanged: !calls.some(c => NOT_ALLOWED.includes(c.name)) && await modsState() === before
        })
    };
}

/** Every escape a copy left in the run's record files, as `file: line`. */
function leftEscapes() {
    return filesUnder(projectsDir).filter(file => file.endsWith('.yaml')).flatMap(file => {
        const line = leftEscape(fs.readFileSync(file, 'utf8'));
        return line === undefined ? [] : [`${path.relative(projectsDir, file)}: ${line.trim()}`];
    });
}

/** A record's text with its link comments, line ends and trailing spaces aside — `# IronSword` after a FormID. */
const bareRecord = text => text.replace(/\r\n/g, '\n').replace(/([0-9A-Fa-f]{6}:\S+\.es[mpl])[ \t]+#[^\n]*/gi, '$1')
    .split('\n').map(line => line.trimEnd()).join('\n').trimEnd();

/**
 * The run's overrides that change nothing, as `project: FormKey`: each file reads as readRecord shows the record in a
 * plugin other than the project's own. Such a copy only undoes, in game, what mods loaded before it change there.
 */
async function unchangedCopies() {
    const copies = [];
    for (const project of fs.existsSync(projectsDir) ? fs.readdirSync(projectsDir) : []) {
        const { plugin, records } = projectRecords(project);
        for (const { formKey, text, file } of records) {
            if (!plugin || !formKey || formKey.toLowerCase().endsWith(`:${plugin.toLowerCase()}`)) continue;
            // A worldspace's copy is the frame its exterior cells' copies are in, unchanged by nature, as addPatch of a cell
            // writes it (since round 133's outdoor task); an interior cell's copy is skipped below by its several files.
            if (/^Worldspaces\/[^/]+\/RecordData\.yaml$/i.test(file)) continue;
            try {
                const theirs = (await callServerJson('readRecord', { record: formKey })).versions
                    ?.find(v => v.plugin?.toLowerCase() !== plugin.toLowerCase());
                if (theirs?.files?.length === 1 && typeof theirs.files[0].text === 'string'
                    && bareRecord(theirs.files[0].text) === bareRecord(text)) copies.push(`${project}: ${formKey}`);
            } catch {
                // A FormKey the load order lacks, or an answer cut short: no copy of a record it has.
            }
        }
    }
    return copies;
}

// The Blender task runs with --blender alone, or when --tasks names it: it needs Blender's MCP server, which a run keeps only then.
// A group's tasks with --group; without, the main set: the tasks of no group.
const wanted = opt.tasks ? opt.tasks.split(',').map(s => s.trim())
    : TASKS.filter(t => (opt.group ? t.group === opt.group : !t.group) && (!t.blender || opt.blender)).map(t => t.id);
const unknownTasks = wanted.filter(id => !TASKS.some(t => t.id === id));
if (unknownTasks.length) fail(`unknown task(s) ${unknownTasks.join(', ')}; the tasks are ${TASKS.map(t => t.id).join(', ')}.`);
const tasks = TASKS.filter(t => wanted.includes(t.id)).flatMap(t => [
    t,
    ...opt.detailed && t.detailed ? [{ ...t, id: `${t.id}+detailed`, prompt: t.detailed, check: t.detailedCheck ?? t.check }] : []
]);

// --- A run --------------------------------------------------------------------------------------

function emptyProjects() {
    for (const entry of fs.readdirSync(projectsDir)) fs.rmSync(path.join(projectsDir, entry), { recursive: true, force: true });
}

/** One task through OpenClaw, with the model behind the proxy; a task's `before` sets the instance up, `after` puts it back. */
async function runTask(task, run) {
    emptyProjects();
    await task.before?.();
    try {
        const started = Date.now();
        const session = await runOpenClaw({
            entry: openClaw.entry, prompt: task.prompt, provider: opt.provider, model: opt.model, cwd: projectsDir, configFile: openClaw.file,
            workspaceFiles: openClaw.workspaceFiles, proxy: openClaw.proxy, toolNames, instructionsLine,
            maxTurns: MAX_TURNS, timeoutMs: TURN_TIMEOUT_MS, thinking: THINKING
        });
        return await resultOf(task, run, { ...session, turns: session.turnStats, started });
    } finally {
        await task.after?.();
    }
}

/** A run's record: the checks and the counts. */
async function resultOf(task, run, { answer, calls, stop, turns, started, phases, client }) {
    const checking = Date.now();
    // A task's facts are recorded beside its checks and count for nothing. A check that throws fails the run and keeps it:
    // round 130's recipe+detailed #3–#5 threw on a recipe of none, and the round lost their calls and answers.
    const { facts, ...checks } = stop === 'answered' || stop === 'maxTurns'
        ? await Promise.resolve().then(() => task.check({ answer, calls }))
            .catch(error => ({ checkRan: false, facts: { checkError: String(error?.message ?? error) } }))
        : {};
    // Every task that leaves record files is held to them having no escapes a copy should have decoded.
    const escapes = leftEscapes();
    // And to keeping no copy of a record that changes nothing: 6 of the sword runs of rounds 33–43 passed with the Iron
    // Sword or a fire enchantment copied with addPatch and built into the plugin untouched, beside the new sword.
    const copies = Object.keys(checks).length ? await unchangedCopies() : [];
    if (Object.keys(checks).length && filesUnder(projectsDir).some(file => file.endsWith('.yaml'))) {
        checks.noEscapesCopied = escapes.length === 0;
        checks.noUnchangedCopy = copies.length === 0;
    }
    const checked = Date.now();
    return {
        task: task.id,
        run,
        success: Object.keys(checks).length > 0 && Object.values(checks).every(Boolean),
        checks,
        ...(facts ? { facts } : {}),
        ...(copies.length ? { unchangedCopies: copies } : {}),
        stop,
        turns: turns.length,
        calls: calls.length,
        invalidParams: calls.filter(c => c.code === -32602).length,
        unknownTools: calls.filter(c => c.unknownTool).length,
        otherErrors: calls.filter(c => c.isError && c.code !== -32602 && !c.unknownTool && !c.deployRefused).length,
        deployRefused: calls.filter(c => c.deployRefused).length,
        truncated: calls.filter(c => c.truncated).length,
        argsAsText: calls.filter(c => c.argsWereText).length,
        maxPromptTokens: Math.max(0, ...turns.map(t => t.promptTokens)),
        outputTokens: turns.reduce((sum, t) => sum + t.outputTokens, 0),
        seconds: Math.round((Date.now() - started) / 100) / 10,
        // The seconds outside the model's turns, OpenClaw's (runPhases) and the eval's checks.
        phases: { ...phases, checks: Math.round((checked - checking) / 100) / 10 },
        answer: answer.length > 1500 ? `${answer.slice(0, 1500)}…` : answer,
        ...(escapes.length ? { escapes } : {}),
        ...(client ? { client } : {}),
        transcript: calls,
        turnStats: turns
    };
}

// --- Run ----------------------------------------------------------------------------------------

const results = [];
const toolListBytes = Buffer.byteLength(JSON.stringify(offered.map(t => ({ name: t.name, description: t.description, parameters: t.inputSchema }))));
console.log(`eval: ${offered.length} of the plugin's tools offered, ${toolListBytes} bytes of tool schemas; instructions ${instructions.length} chars`);

/**
 * Loads the model before the first task, with a short "hi" at the context the tasks use, so no task's
 * time includes the load. When OpenClaw asks for no context size, the warm-up sends none either:
 * Ollama's default is then what both use. A model that was not loaded yet — a switch from another —
 * is given --settle seconds more before the tasks start. An OpenAI server holds its model at its own context.
 */
async function warmUp() {
    const resident = OPENAI
        // A server that names no state holds its model loaded.
        ? (await openAi('/models').catch(() => ({ data: [] }))).data.some(m => m.id === opt.model && (m.status?.value ?? 'loaded') === 'loaded')
        : (await ollama('/api/ps').catch(() => ({ models: [] }))).models
            .some(m => (m.name === opt.model || m.model === opt.model) && (CTX === undefined || m.context_length === CTX));
    const started = Date.now();
    if (OPENAI) {
        await openAi('/chat/completions', { model: opt.model, messages: [{ role: 'user', content: 'hi' }], max_tokens: 16 });
    } else {
        await ollama('/api/chat', {
            model: opt.model, stream: false, think: false,
            messages: [{ role: 'user', content: 'hi' }],
            options: { ...(CTX === undefined ? {} : { num_ctx: CTX }), num_predict: 16 }
        });
    }
    const seconds = Math.round((Date.now() - started) / 100) / 10;
    console.log(`eval: warm-up "hi" answered in ${seconds} s${resident ? ' (the model was loaded already)' : ''}`);
    if (!resident && SETTLE_SECONDS > 0) {
        console.log(`eval: the model was loaded just now; waiting ${SETTLE_SECONDS} s before the first task`);
        await new Promise(resolve => setTimeout(resolve, SETTLE_SECONDS * 1000));
    }
    return { seconds, wasLoaded: resident };
}
/**
 * --check <folder>: the checks alone, no model run. Each folder in it is a projects folder made by hand, named
 * `<task>[+detailed]--<what it is>` and holding that task's project, built; its checks run on it as on a run's projects,
 * after a build that succeeded. A correct mod passes every check; a broken one fails the check its fault is for — the
 * checks of the tasks added in round 125 were tried so before a model ran them. The record goes to --out.
 */
async function checkCases(folder) {
    const variants = TASKS.flatMap(t => [t, ...t.detailed ? [{ ...t, id: `${t.id}+detailed`, prompt: t.detailed, check: t.detailedCheck ?? t.check }] : []]);
    const checked = [];
    for (const name of fs.readdirSync(folder, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name).sort()) {
        const task = variants.find(t => t.id === name.split('--')[0]);
        if (!task) {
            console.log(`check ${name}: no task ${name.split('--')[0]}`);
            continue;
        }
        projectsDir = path.resolve(folder, name);
        const project = fs.readdirSync(projectsDir).find(entry => fs.existsSync(path.join(projectsDir, entry, 'plugin')));
        // A case's own calls where it has them (calls.json beside its project): the Blender task's checks read them.
        const callsFile = path.join(projectsDir, 'calls.json');
        const calls = fs.existsSync(callsFile) ? JSON.parse(fs.readFileSync(callsFile, 'utf8'))
            : [{ name: 'buildProject', args: { project }, isError: false, result: '{"status":"success"}' }];
        // And its answer where it has one (answer.txt): the conflict task's checks read it.
        const answerFile = path.join(projectsDir, 'answer.txt');
        const answer = fs.existsSync(answerFile) ? fs.readFileSync(answerFile, 'utf8') : '';
        const result = await resultOf(task, 0, { answer, calls, stop: 'answered', turns: [], started: Date.now(), phases: {} });
        const failed = Object.entries(result.checks).filter(([, ok]) => !ok).map(([check]) => check);
        console.log(`check ${name}: ${result.success ? 'PASS' : 'FAIL'}${failed.length ? ` — failed: ${failed.join(', ')}` : ''}` +
            (result.facts ? ` (facts ${JSON.stringify(result.facts)})` : ''));
        checked.push({ case: name, success: result.success, failed, checks: result.checks, facts: result.facts });
    }
    fs.writeFileSync(outFile, `${JSON.stringify(checked, null, 2)}\n`);
}
if (opt.check) {
    await checkCases(path.resolve(opt.check)).catch(error => fail(`the checks failed: ${error.stack ?? error.message}`));
    cleanUp();
    await stopBackends();
    process.exit(0);
}

const warmup = await warmUp().catch(error => fail(`the warm-up failed: ${error.message}`));

try {
    for (const task of tasks) {
        for (let run = 1; run <= runsOf(task); run++) {
            let result;
            try {
                result = await runTask(task, run);
            } catch (error) {
                // A fault of the harness fails its run, not the round.
                result = {
                    task: task.id, run, success: false, checks: {}, stop: `evalError:${String(error?.message ?? error).split('\n')[0]}`,
                    turns: 0, calls: 0, invalidParams: 0, unknownTools: 0, otherErrors: 0, deployRefused: 0, truncated: 0,
                    argsAsText: 0, maxPromptTokens: 0, outputTokens: 0, seconds: 0, answer: '',
                    transcript: [], turnStats: []
                };
            }
            results.push(result);
            // The runs so far, kept for a round that does not get to its end.
            fs.writeFileSync(outFile.replace(/\.json$/, '.partial.json'), JSON.stringify(results));
            const failed = Object.entries(result.checks).filter(([, ok]) => !ok).map(([name]) => name);
            console.log(`  ${task.id} #${run}: ${result.success ? 'PASS' : 'FAIL'} — ${result.stop}, ${result.turns} turns, ` +
                `${result.calls} calls (${result.invalidParams} invalid, ${result.otherErrors} other errors), ` +
                `${result.seconds}s${failed.length ? `; failed: ${failed.join(', ')}` : ''}`);
        }
    }
} finally {
    openClaw.proxy.close();
    stopBackends();
    cleanUp();
}

const loaded = OPENAI ? { models: [] } : await ollama('/api/ps').catch(() => ({ models: [] }));

/**
 * How fast the model reads a prompt and writes an answer on this machine, at this context: the tool
 * reference (~3,400 tokens) to summarise in 300 tokens, three times, the median of each. Measured apart
 * from the tasks, whose turns reuse Ollama's prompt cache and answer in a few dozen tokens — figures
 * taken from them would not compare between rounds. A fresh first line keeps the cache out of it here.
 * The reference is the core's, rendered as the MCP server's docs/Tool-Reference.md is, which rounds up to 63 read.
 * An OpenAI server is timed by the llama.cpp `timings` of its answer; one without them is not measured.
 */
async function measureSpeed() {
    const doc = renderToolReference(collectToolFamilies(product));
    const samples = [];
    for (let i = 0; i < 3; i++) {
        const prompt = `Run ${Date.now()}-${i}.\n\n${doc}\n\nSummarise the document above in about 250 words.`;
        if (OPENAI) {
            const { timings } = await openAi('/chat/completions', {
                model: opt.model, messages: [{ role: 'user', content: prompt }], max_tokens: 300, seed: i
            });
            if (!timings) throw new Error(`${SERVER_NAME} gives no timings with its answer`);
            samples.push({ promptTokens: timings.prompt_n, prompt: timings.prompt_per_second, generation: timings.predicted_per_second });
            continue;
        }
        const reply = await ollama('/api/generate', {
            model: opt.model, stream: false, think: false,
            prompt,
            options: { ...(CTX === undefined ? {} : { num_ctx: CTX }), num_predict: 300, seed: i }
        });
        samples.push({
            promptTokens: reply.prompt_eval_count,
            prompt: reply.prompt_eval_count / (reply.prompt_eval_duration / 1e9),
            generation: reply.eval_count / (reply.eval_duration / 1e9)
        });
    }
    const median = key => samples.map(s => s[key]).sort((a, b) => a - b)[1];
    return { promptTokens: samples[0].promptTokens, promptPerSecond: Math.round(median('prompt')), generationPerSecond: Math.round(median('generation')) };
}

const speed = await measureSpeed().catch(error => {
    printError(`eval: the speed measurement failed: ${error.message}`);
    return null;
});

/** The build that was measured: this repository's commit, whether the working tree differed from it, and the core's version. */
function measuredBuild() {
    const git = args => {
        try {
            return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
        } catch {
            return undefined;
        }
    };
    let core = '?';
    try {
        core = JSON.parse(fs.readFileSync(path.join(root, 'node_modules', 'skyrim-modding-tools-core', 'package.json'), 'utf8')).version;
    } catch { /* not installed */ }
    const commit = git(['rev-parse', '--short', 'HEAD']);
    if (!commit) return `unknown (no git), core v${core}`;
    return `${commit}${git(['status', '--porcelain', '--untracked-files=no']) ? ' + uncommitted changes' : ''}, core v${core}`;
}

/** A run's phases outside the model's turns (runPhases, and the eval's checks), as the record names them. */
const PHASES = [
    ['start', "for OpenClaw's start"], ['between', 'between the turns'], ['exit', 'for its exit'],
    ['cleanup', 'to remove its state folder'], ['checks', "for the eval's checks"]
];

/** The mean of each phase over the runs that have it. */
function meanPhases(runs) {
    return Object.fromEntries(PHASES.map(([key]) => {
        const values = runs.map(r => r.phases?.[key]).filter(v => typeof v === 'number');
        return [key, values.length ? Math.round(values.reduce((sum, v) => sum + v, 0) / values.length * 10) / 10 : null];
    }));
}

const allTurns = results.flatMap(r => r.turnStats);
// The session's first turn loads the model; it says nothing about a turn's cost.
const laterTurns = allTurns.slice(1);
/**
 * OpenClaw's side of a run: what its first prompt carried — its tools, how many the plugin's, whether Tool Search was
 * on, whether the plugin's instructions were in it, the thinking, context and answer cap it asked for — answers that
 * did not end, turns Ollama ended at the cap or the context's end (a model looped ~111,000 tokens until the context was
 * full, twice in round 21 and once in round 22), and what the plugin's build check asked.
 */
const openClawSummary = (() => {
    const firsts = results.map(r => r.turnStats[0]).filter(Boolean);
    const firstTokens = firsts.map(t => t.firstTokenSeconds).filter(s => s !== null).sort((a, b) => a - b);
    const sum = key => results.reduce((total, r) => total + (r.client?.[key] ?? 0), 0);
    return {
        version: openClaw.version,
        entry: openClaw.entry,
        config: openClaw.configFile,
        ...(openClaw.agentId ? { agent: openClaw.agentId } : {}),
        workspaceFiles: openClaw.workspaceFiles.map(f => f.name),
        ...(openClaw.copiedFrom ? { modelSettingsFrom: openClaw.copiedFrom } : {}),
        plugins: openClaw.plugins ?? 'all',
        firstPrompt: results.find(r => r.client?.firstPrompt)?.client.firstPrompt ?? null,
        firstPromptTokens: Math.max(0, ...firsts.map(t => t.promptTokens)),
        medianFirstTokenSeconds: firstTokens.length ? firstTokens[Math.floor(firstTokens.length / 2)] : null,
        instructionsMissing: results.filter(r => r.client?.firstPrompt && !r.client.firstPrompt.instructionsInPrompt).length,
        cutAnswers: sum('cutAnswers'),
        lengthStops: results.reduce((total, r) => total + r.turnStats.filter(t => t.doneReason === 'length').length, 0),
        sideRequests: results.reduce((total, r) => total + (r.client?.sideRequests.length ?? 0), 0),
        buildCheckAsked: results.filter(r => r.client?.buildCheckAsked > 0).length,
        buildCheckDropped: sum('buildCheckDropped'),
        textCallAsked: results.filter(r => r.client?.textCallAsked > 0).length,
        announcedAsked: results.filter(r => r.client?.announcedAsked > 0).length,
        phases: meanPhases(results)
    };
})();
const first = openClawSummary.firstPrompt;

const report = {
    model: opt.model,
    profile: opt.profile,
    client: 'openclaw-plugin',
    openClaw: openClawSummary,
    ollamaVersion: ollamaVersion ?? null,
    ...(OPENAI ? { server: { provider: opt.provider, api: SERVER.api, url: SERVER.url } } : {}),
    warmup,
    // OpenClaw asks an OpenAI server for no context: it runs at the window it was started with.
    numCtx: OPENAI ? CTX ?? '?' : first?.numCtx ?? 'Ollama default',
    think: String(first?.think ?? "OpenClaw's default"),
    runs: RUNS,
    authoringRuns: AUTHORING_RUNS,
    when: new Date().toISOString(),
    build: BUILD,
    secondsPerTurn: laterTurns.length
        ? Math.round(laterTurns.reduce((sum, t) => sum + t.seconds, 0) / laterTurns.length * 100) / 100
        : null,
    speed,
    toolListBytes,
    instructionsChars: instructions.length,
    ollama: loaded.models.find(m => m.name === opt.model || m.model === opt.model) ?? null,
    truth,
    summary: tasks.map(task => {
        const mine = results.filter(r => r.task === task.id);
        const mean = key => Math.round(mine.reduce((sum, r) => sum + r[key], 0) / mine.length * 10) / 10;
        return {
            task: task.id,
            passed: `${mine.filter(r => r.success).length}/${mine.length}`,
            turns: mean('turns'),
            calls: mean('calls'),
            invalidParams: mine.reduce((s, r) => s + r.invalidParams, 0),
            unknownTools: mine.reduce((s, r) => s + r.unknownTools, 0),
            otherErrors: mine.reduce((s, r) => s + r.otherErrors, 0),
            maxPromptTokens: Math.max(...mine.map(r => r.maxPromptTokens)),
            seconds: mean('seconds')
        };
    }),
    results
};
fs.writeFileSync(outFile, JSON.stringify(report, null, 2));

console.log('');
console.table(report.summary);
const passed = results.filter(r => r.success).length;
console.log(`eval: ${passed}/${results.length} passed. Full record: ${outFile}`);
// A ratio rather than sizes: for some models, Ollama 0.40 reports sizes a tenth of the real ones.
const onGpu = report.ollama ? `${Math.round((report.ollama.size_vram ?? 0) / (report.ollama.size || 1) * 100)}%` : '?';
if (report.ollama) console.log(`eval: Ollama ran it with context ${report.ollama.context_length ?? '?'}, ${onGpu} on the GPU`);
const rate = value => value === undefined ? '?' : `~${value.toLocaleString('en-US')} tokens/s`;
if (speed) console.log(`eval: prompt ${rate(speed.promptPerSecond)} (${speed.promptTokens} tokens), generation ${rate(speed.generationPerSecond)}`);

// The entry for docs/research/local-model-evals.md, where every round is recorded. The client — the plugin in
// OpenClaw — and the Ollama build, or the OpenAI server, are named beside the profile.
const notesWritten = results.filter(r => r.facts && 'emptyLinesKept' in r.facts);
const setup = [`\`${report.profile}\``, 'OpenClaw plugin', ...(OPENAI ? [SERVER_NAME] : ollamaVersion ? [`Ollama ${ollamaVersion}`] : [])].join(', ');
const openClawTools = !first ? '? tools'
    : `${first.tools} tools, ${first.pluginToolsListed} of them the plugin's${first.toolSearch ? ', the rest behind Tool Search' : ''}`;
const entry = [
    `| ${report.when.slice(0, 10)} | ${report.model} | ${setup} | ${report.build} | ${passed}/${results.length} | ` +
    `${report.secondsPerTurn ?? '?'} s | ${rate(speed?.promptPerSecond)} | ${rate(speed?.generationPerSecond)} | ${onGpu} |`,
    '',
    `Through ${openClawSummary.version}${openClaw.plugins ? ` with the plugins ${openClaw.plugins.join(' and ')} alone` : ' with all its plugins'}: ` +
    `first prompt ${openClawSummary.firstPromptTokens} tokens (${openClawTools}), ` +
    `the plugin's instructions in ${results.length - openClawSummary.instructionsMissing} of ${results.length} prompts, ` +
    `think ${report.think}, num_ctx ${report.numCtx}, num_predict ${first?.numPredict ?? 'none'}, ` +
    `temperature ${first?.temperature ?? (OPENAI ? "the server's" : "the Modelfile's")}, ` +
    `first token after ${openClawSummary.medianFirstTokenSeconds ?? '?'} s (median of the first turns), ` +
    `${openClawSummary.cutAnswers} answers cut off, ${openClawSummary.lengthStops} turns ended at the length limit, ` +
    `${openClawSummary.sideRequests} side requests; the build check asked for a build in ${openClawSummary.buildCheckAsked} ` +
    `runs, the text-call check asked for a call in ${openClawSummary.textCallAsked}, the announced-step check for its step ` +
    `in ${openClawSummary.announcedAsked}, and OpenClaw dropped ` +
    `${openClawSummary.buildCheckDropped} of those passes. Outside the turns a run took on average ` +
    `${PHASES.map(([key, name]) => `${openClawSummary.phases[key] ?? '?'} s ${name}`).join(', ')}.` +
    (notesWritten.length ? ` Of the ${notesWritten.length} notes written, ${notesWritten.filter(r => r.facts.emptyLinesKept).length} ` +
        "kept the game's empty lines (recorded, not scored)." : ''),
    '',
    '| task | passed | turns | calls | invalid arguments | other errors | largest prompt (tokens) | seconds |',
    '|---|---|---|---|---|---|---|---|',
    ...report.summary.map(s => `| ${s.task} | ${s.passed} | ${s.turns} | ${s.calls} | ${s.invalidParams} | ${s.otherErrors} | ` +
        `${s.maxPromptTokens} | ${s.seconds} |`)
].join('\n');
fs.writeFileSync(outFile.replace(/\.json$/, '.md'), `${entry}\n`);
console.log(`\neval: the entry for docs/research/local-model-evals.md (num_ctx ${report.numCtx}, think ${report.think}):\n\n${entry}`);
