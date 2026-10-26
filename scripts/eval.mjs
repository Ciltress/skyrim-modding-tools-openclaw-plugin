#!/usr/bin/env node
/**
 * Measures how well a local model drives this plugin through OpenClaw: a fixed set of modding tasks, each run through
 * OpenClaw itself, headless (`openclaw agent exec`), with the model served by Ollama behind a logging proxy
 * (scripts/eval-openclaw.mjs) — what a user of OpenClaw with a local model gets, on their own OpenClaw configuration
 * and agent: its system prompt with the plugin's instructions, its tools, Tool Search, its thinking level and context.
 *
 *   npm run build
 *   node scripts/eval.mjs --openclaw-agent skyrim-e4b [--model gemma4:e4b] [--profile all] [--runs 3]
 *                         [--authoring-runs 5] [--tasks find,read] [--max-turns 25] [--think true|false|<level>]
 *                         [--detailed] [--out <file>] [--ollama http://localhost:11434] [--settle 60]
 *                         [--openclaw <openclaw.mjs>] [--openclaw-config <openclaw.json>]
 *
 * The agent is --openclaw-agent, else the plugin's only modding agent, else the configuration's only agent.
 * --authoring-runs sets the runs of the tasks that write records (sword, spell, npc, note, and their `+detailed`
 * runs), --runs those of the others; it defaults to --runs. Every miss of rounds 24–31 was an authoring task's, and
 * with three runs each a round's noise was about ±3 of 39. --think true|false|<level> passes a thinking level for the
 * run (true is OpenClaw's `medium`, false `off`); unset, the agent's own.
 *
 * Before the first task the model is loaded with a short "hi", so no task's time includes the load; when it was not
 * loaded yet (a switch from another model), --settle seconds pass before the tasks.
 *
 * --detailed runs each authoring task again as `<task>+detailed`, with a prompt that spells out what a player who
 * knows the game would ask for — stats, the vanilla thing it is like, the level — but no editor IDs; the checks stay
 * the same, so the two compare.
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
import { NOT_ALLOWED, openClawConfigFile, openClawEntry, openClawVersion, runOpenClaw, startProxy, writeSessionConfig } from './eval-openclaw.mjs';
import { leftEscape, translatedValue } from './eval-yaml.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const { values: opt } = parseArgs({
    options: {
        model: { type: 'string', default: 'gemma4:e4b' },
        profile: { type: 'string', default: 'all' },
        runs: { type: 'string', default: '3' },
        'authoring-runs': { type: 'string' },
        tasks: { type: 'string' },
        'max-turns': { type: 'string', default: '25' },
        settle: { type: 'string', default: '60' },
        think: { type: 'string' },
        out: { type: 'string' },
        detailed: { type: 'boolean', default: false },
        ollama: { type: 'string', default: process.env.OLLAMA_HOST || 'localhost' },
        openclaw: { type: 'string' },
        'openclaw-config': { type: 'string' },
        'openclaw-agent': { type: 'string' }
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

// --- Ollama -------------------------------------------------------------------------------------

async function ollama(route, body) {
    const response = await fetch(`${OLLAMA}${route}`, {
        method: body ? 'POST' : 'GET',
        headers: body ? { 'content-type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(TURN_TIMEOUT_MS)
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`Ollama ${route} answered ${response.status}: ${text.slice(0, 500)}`);
    return JSON.parse(text);
}

const tags = await ollama('/api/tags').catch(error => fail(`Ollama is not reachable at ${OLLAMA}: ${error.message}`));
if (!tags.models.some(m => m.name === opt.model || m.model === opt.model)) {
    fail(`Ollama has no model '${opt.model}'. Pulled: ${tags.models.map(m => m.name).join(', ')}.`);
}
const ollamaVersion = (await ollama('/api/version').catch(() => ({}))).version;

// --- OpenClaw and the plugin --------------------------------------------------------------------

const projectsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skyrim-eval-projects-'));
leftovers.push(projectsDir);

// OpenClaw: its entry script, the proxy in front of Ollama, and the session's configuration.
const openClaw = await (async () => {
    const entry = openClawEntry(opt.openclaw)
        ?? fail('OpenClaw was not found: install it (npm install -g openclaw), or pass --openclaw <path to openclaw.mjs>.');
    let version;
    try { version = openClawVersion(entry); } catch (error) { fail(`OpenClaw did not start (${entry}): ${error.message}`); }
    const configFile = openClawConfigFile(opt['openclaw-config']);
    if (!fs.existsSync(configFile)) fail(`OpenClaw's configuration ${configFile} does not exist: run openclaw onboard, or pass --openclaw-config.`);
    const proxy = await startProxy(OLLAMA);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skyrim-eval-openclaw-'));
    leftovers.push(dir);
    let session;
    try {
        session = writeSessionConfig({
            dir, configFile, proxyUrl: proxy.url, model: opt.model, root, projectsDir, agent: opt['openclaw-agent'], profile: opt.profile
        });
    } catch (error) {
        fail(error.message);
    }
    return { entry, version, configFile, proxy, dir, ...session };
})();
/** The context the tasks run at: what OpenClaw asks Ollama for (nothing: Ollama's default). */
const CTX = openClaw.numCtx;

// The plugin's tools, built, on the session's settings: the ground truth and the checks read the instance through them.
const product = pluginProduct(root);
const settings = readSettings(openClaw.pluginConfig, root);
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

// Read before the first task: a commit made while the round runs is not the build it measured (round 32's e4b row named
// the commit made during its last task).
const BUILD = measuredBuild();
console.log(`eval: ${opt.model} @ num_ctx ${CTX ?? 'Ollama default'}, profile ${opt.profile}, ${RUNS} run(s) per task` +
    (AUTHORING_RUNS === RUNS ? '' : `, ${AUTHORING_RUNS} per authoring task`) + `, build ${BUILD}, Ollama ${ollamaVersion ?? '?'}`);
console.log(`eval: through ${openClaw.version} (${openClaw.entry}), on the configuration ${openClaw.configFile}` +
    `${openClaw.agentId ? `, agent '${openClaw.agentId}'` : ''}` +
    `${openClaw.workspaceFiles.length ? ` with ${openClaw.workspaceFiles.map(f => f.name).join(', ')}` : ''}` +
    (openClaw.copiedFrom ? ` — ${opt.model} with the settings of its entry for ${openClaw.copiedFrom}` : ''));
console.log('eval: reading the ground truth from the instance (the first lookup builds the index)…');
const truth = {
    ironSword: await weapon('IronSword'),
    steelSword: await weapon('SteelSword'),
    nordRace: (await callServerJson('findRecords', { records: ['NordRace'], limit: 1 })).records[0]?.formId
        ?? fail('the instance has no NordRace'),
    // A note whose text has line breaks and quotes, and whose model path has backslashes: what a copy
    // has to carry over exactly.
    mavenNote: await (async () => {
        const read = await callServerJson('readRecord', { record: 'LetterRiftenBlackBriarMeadery04' });
        const text = translatedValue(read.versions[0].files.map(f => f.text).join('\n'), 'BookText');
        if (!text?.includes('"')) fail('could not read the text of Note From Maven');
        return { formId: read.formId, text };
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
        return { group: path.relative(pluginDir, file).split(path.sep)[0].toLowerCase(), text, formKey: /^FormKey:\s*(\S+)/m.exec(text)?.[1] };
    });
    return { plugin, records };
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

/** The magic effects behind a spell or an enchantment, as text, wherever each is. */
async function effectTexts(project, text) {
    return Promise.all(effectsOf(text).map(effect => recordAnywhere(project, effect)));
}

/** Built: buildProject succeeded, and the project's build folder holds a plugin. */
const builtProject = (project, calls) =>
    calls.some(c => c.name === 'buildProject' && !c.isError) &&
    filesUnder(path.join(projectsDir, project, 'build')).some(f => /\.es[pml]$/i.test(f));

/** A number standing on its own: 7 in "damage 7." but not in "012EB7" or "7.5". */
const has = (text, value) => new RegExp(`(^|[^\\w.])${String(value).replace(/\./g, '\\.')}(?![\\w]|\\.\\d)`, 'i').test(text);

/** A FormID's local part however it is written: 012EB7, 00012EB7, 0x00012EB7. */
const hasFormId = (text, formId) =>
    new RegExp(`(^|[^0-9a-f])(0x)?0*${formId.split(':')[0].replace(/^0+/, '')}(?![0-9a-f])`, 'i').test(text);

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
            const built = filesUnder(path.join(projectsDir, 'SteelSwordLight', 'build')).some(f => /\.es[pml]$/i.test(f));
            return {
                recordInProject: !!text,
                weight5: /^\s+Weight:\s*5\s*$/m.test(text),
                built: built && calls.some(c => c.name === 'buildProject' && !c.isError)
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
            const sword = newRecords('FlameBlade', 'weapons').find(r => /^flame blade$/i.test(nameOf(r.text)));
            const enchantment = sword && /^ObjectEffect:[ \t]*([^\s#]+)/m.exec(sword.text)?.[1];
            const effects = enchantment ? await effectTexts('FlameBlade', await recordAnywhere('FlameBlade', enchantment)) : [];
            return {
                newSword: !!sword,
                // The sword keyword by its FormID, or by its editor ID, which the build keeps in the file since round 48.
                oneHandedSword: !!sword && (/AnimationType:[ \t]*OneHandSword/.test(sword.text) || sword.text.includes('01E711:Skyrim.esm')
                    || /^[ \t]*-[ \t]*WeapTypeSword[ \t]*(?:#.*)?\r?$/m.test(sword.text)),
                // A sword the player can carry: copied from the Bound Sword, 10 of e4b's of rounds 31–44 kept its
                // NonPlayable and BoundWeapon flags — a conjured weapon, kept out of the inventory — and 9 passed without this.
                playable: !!sword && !/^[ \t]+-[ \t]*(?:NonPlayable|BoundWeapon)[ \t]*\r?$|^[ \t]*Flags:[ \t]*\[[^\]\r\n]*\b(?:NonPlayable|BoundWeapon)\b/m.test(sword.text),
                fireEnchantment: effects.some(text => /^ResistValue:[ \t]*ResistFire[ \t]*\r?$/m.test(text)),
                built: builtProject('FlameBlade', calls)
            };
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
            const race = npc && await linkTarget('HildaTheNord', /^Race:[ \t]*([^\s#]+)/m.exec(npc.text)?.[1]);
            return {
                newNpc: !!npc,
                nord: race?.toLowerCase() === truth.nordRace.toLowerCase(),
                female: !!npc && hasFlag(npc.text, 'Female'),
                built: builtProject('HildaTheNord', calls)
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
        check: ({ calls }) => {
            const note = newRecords('MavenNote', 'books')
                .find(r => translatedValue(r.text, 'Name')?.toLowerCase() === "maven's warning");
            return {
                newNote: !!note,
                textCopied: !!note && translatedValue(note.text, 'BookText') === truth.mavenNote.text,
                built: builtProject('MavenNote', calls)
            };
        }
    }
];

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
        for (const { formKey, text } of records) {
            if (!plugin || !formKey || formKey.toLowerCase().endsWith(`:${plugin.toLowerCase()}`)) continue;
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

const wanted = opt.tasks ? opt.tasks.split(',').map(s => s.trim()) : TASKS.map(t => t.id);
const unknownTasks = wanted.filter(id => !TASKS.some(t => t.id === id));
if (unknownTasks.length) fail(`unknown task(s) ${unknownTasks.join(', ')}; the tasks are ${TASKS.map(t => t.id).join(', ')}.`);
const tasks = TASKS.filter(t => wanted.includes(t.id)).flatMap(t => [
    t,
    ...opt.detailed && t.detailed ? [{ ...t, id: `${t.id}+detailed`, prompt: t.detailed }] : []
]);

// --- A run --------------------------------------------------------------------------------------

function emptyProjects() {
    for (const entry of fs.readdirSync(projectsDir)) fs.rmSync(path.join(projectsDir, entry), { recursive: true, force: true });
}

/** One task through OpenClaw, with the model behind the proxy. */
async function runTask(task, run) {
    emptyProjects();
    const started = Date.now();
    const session = await runOpenClaw({
        entry: openClaw.entry, prompt: task.prompt, model: opt.model, cwd: projectsDir, configFile: openClaw.file,
        workspaceFiles: openClaw.workspaceFiles, proxy: openClaw.proxy, toolNames, instructionsLine,
        maxTurns: MAX_TURNS, timeoutMs: TURN_TIMEOUT_MS, thinking: THINKING
    });
    return resultOf(task, run, { ...session, turns: session.turnStats, started });
}

/** A run's record: the checks and the counts. */
async function resultOf(task, run, { answer, calls, stop, turns, started, client }) {
    const checks = stop === 'answered' || stop === 'maxTurns'
        ? await task.check({ answer, calls })
        : {};
    // Every task that leaves record files is held to them having no escapes a copy should have decoded.
    const escapes = leftEscapes();
    // And to keeping no copy of a record that changes nothing: 6 of e4b's sword runs of rounds 33–43 passed with the Iron
    // Sword or a fire enchantment copied with addPatch and built into the plugin untouched, beside the new sword.
    const copies = Object.keys(checks).length ? await unchangedCopies() : [];
    if (Object.keys(checks).length && filesUnder(projectsDir).some(file => file.endsWith('.yaml'))) {
        checks.noEscapesCopied = escapes.length === 0;
        checks.noUnchangedCopy = copies.length === 0;
    }
    return {
        task: task.id,
        run,
        success: Object.keys(checks).length > 0 && Object.values(checks).every(Boolean),
        checks,
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
 * is given --settle seconds more before the tasks start.
 */
async function warmUp() {
    const resident = (await ollama('/api/ps').catch(() => ({ models: [] }))).models
        .some(m => (m.name === opt.model || m.model === opt.model) && (CTX === undefined || m.context_length === CTX));
    const started = Date.now();
    await ollama('/api/chat', {
        model: opt.model, stream: false, think: false,
        messages: [{ role: 'user', content: 'hi' }],
        options: { ...(CTX === undefined ? {} : { num_ctx: CTX }), num_predict: 16 }
    });
    const seconds = Math.round((Date.now() - started) / 100) / 10;
    console.log(`eval: warm-up "hi" answered in ${seconds} s${resident ? ' (the model was loaded already)' : ''}`);
    if (!resident && SETTLE_SECONDS > 0) {
        console.log(`eval: the model was loaded just now; waiting ${SETTLE_SECONDS} s before the first task`);
        await new Promise(resolve => setTimeout(resolve, SETTLE_SECONDS * 1000));
    }
    return { seconds, wasLoaded: resident };
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

const loaded = await ollama('/api/ps').catch(() => ({ models: [] }));

/**
 * How fast the model reads a prompt and writes an answer on this machine, at this context: the tool
 * reference (~3,400 tokens) to summarise in 300 tokens, three times, the median of each. Measured apart
 * from the tasks, whose turns reuse Ollama's prompt cache and answer in a few dozen tokens — figures
 * taken from them would not compare between rounds. A fresh first line keeps the cache out of it here.
 * The reference is the core's, rendered as the MCP server's docs/Tool-Reference.md is, which rounds up to 63 read.
 */
async function measureSpeed() {
    const doc = renderToolReference(collectToolFamilies(product));
    const samples = [];
    for (let i = 0; i < 3; i++) {
        const reply = await ollama('/api/generate', {
            model: opt.model, stream: false, think: false,
            prompt: `Run ${Date.now()}-${i}.\n\n${doc}\n\nSummarise the document above in about 250 words.`,
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

const allTurns = results.flatMap(r => r.turnStats);
// The session's first turn loads the model; it says nothing about a turn's cost.
const laterTurns = allTurns.slice(1);
/**
 * OpenClaw's side of a run: what its first prompt carried — its tools, how many the plugin's, whether Tool Search was
 * on, whether the plugin's instructions were in it, the thinking, context and answer cap it asked for — answers that
 * did not end, turns Ollama ended at the cap or the context's end (12b looped ~111,000 tokens until the context was
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
        firstPrompt: results.find(r => r.client?.firstPrompt)?.client.firstPrompt ?? null,
        firstPromptTokens: Math.max(0, ...firsts.map(t => t.promptTokens)),
        medianFirstTokenSeconds: firstTokens.length ? firstTokens[Math.floor(firstTokens.length / 2)] : null,
        instructionsMissing: results.filter(r => r.client?.firstPrompt && !r.client.firstPrompt.instructionsInPrompt).length,
        cutAnswers: sum('cutAnswers'),
        lengthStops: results.reduce((total, r) => total + r.turnStats.filter(t => t.doneReason === 'length').length, 0),
        sideRequests: results.reduce((total, r) => total + (r.client?.sideRequests.length ?? 0), 0),
        buildCheckAsked: results.filter(r => r.client?.buildCheckAsked > 0).length,
        buildCheckDropped: sum('buildCheckDropped'),
        textCallAsked: results.filter(r => r.client?.textCallAsked > 0).length
    };
})();
const first = openClawSummary.firstPrompt;

const report = {
    model: opt.model,
    profile: opt.profile,
    client: 'openclaw-plugin',
    openClaw: openClawSummary,
    ollamaVersion: ollamaVersion ?? null,
    warmup,
    numCtx: first?.numCtx ?? 'Ollama default',
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
// A ratio rather than sizes: for gemma4, Ollama 0.40 reports sizes a tenth of the real ones.
const onGpu = report.ollama ? `${Math.round((report.ollama.size_vram ?? 0) / (report.ollama.size || 1) * 100)}%` : '?';
if (report.ollama) console.log(`eval: Ollama ran it with context ${report.ollama.context_length ?? '?'}, ${onGpu} on the GPU`);
const rate = value => value === undefined ? '?' : `~${value.toLocaleString('en-US')} tokens/s`;
if (speed) console.log(`eval: prompt ${rate(speed.promptPerSecond)} (${speed.promptTokens} tokens), generation ${rate(speed.generationPerSecond)}`);

// The entry for docs/research/local-model-evals.md, where every round is recorded. The client — the plugin in
// OpenClaw — and the Ollama build are named beside the profile.
const setup = [`\`${report.profile}\``, 'OpenClaw plugin', ...(ollamaVersion ? [`Ollama ${ollamaVersion}`] : [])].join(', ');
const openClawTools = !first ? '? tools'
    : `${first.tools} tools, ${first.pluginToolsListed} of them the plugin's${first.toolSearch ? ', the rest behind Tool Search' : ''}`;
const entry = [
    `| ${report.when.slice(0, 10)} | ${report.model} | ${setup} | ${report.build} | ${passed}/${results.length} | ` +
    `${report.secondsPerTurn ?? '?'} s | ${rate(speed?.promptPerSecond)} | ${rate(speed?.generationPerSecond)} | ${onGpu} |`,
    '',
    `Through ${openClawSummary.version}: first prompt ${openClawSummary.firstPromptTokens} tokens (${openClawTools}), ` +
    `the plugin's instructions in ${results.length - openClawSummary.instructionsMissing} of ${results.length} prompts, ` +
    `think ${report.think}, num_ctx ${report.numCtx}, num_predict ${first?.numPredict ?? 'none'}, ` +
    `temperature ${first?.temperature ?? "the Modelfile's"}, ` +
    `first token after ${openClawSummary.medianFirstTokenSeconds ?? '?'} s (median of the first turns), ` +
    `${openClawSummary.cutAnswers} answers cut off, ${openClawSummary.lengthStops} turns ended at the length limit, ` +
    `${openClawSummary.sideRequests} side requests; the build check asked for a build in ${openClawSummary.buildCheckAsked} ` +
    `runs, the text-call check asked for a call in ${openClawSummary.textCallAsked}, and OpenClaw dropped ` +
    `${openClawSummary.buildCheckDropped} of those passes.`,
    '',
    '| task | passed | turns | calls | invalid arguments | other errors | largest prompt (tokens) | seconds |',
    '|---|---|---|---|---|---|---|---|',
    ...report.summary.map(s => `| ${s.task} | ${s.passed} | ${s.turns} | ${s.calls} | ${s.invalidParams} | ${s.otherErrors} | ` +
        `${s.maxPromptTokens} | ${s.seconds} |`)
].join('\n');
fs.writeFileSync(outFile.replace(/\.json$/, '.md'), `${entry}\n`);
console.log(`\neval: the entry for docs/research/local-model-evals.md (num_ctx ${report.numCtx}, think ${report.think}):\n\n${entry}`);
