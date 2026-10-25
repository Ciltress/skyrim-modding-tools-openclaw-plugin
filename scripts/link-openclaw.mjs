// Links the OpenClaw this machine runs as node_modules/openclaw, as OpenClaw itself does for a plugin it installs:
// the plugin compiles against the host's own SDK types, and nothing installs a second copy of the host.
// Runs after npm install. Without a global OpenClaw it says so and leaves node_modules/openclaw alone.
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.join(root, 'node_modules', 'openclaw');

// `npm --prefix <folder> run …` makes <folder> npm's global folder too, for the scripts it runs: asked without
// that, npm names the global folder its own config does.
const env = { ...process.env };
if (env.npm_config_prefix && path.resolve(env.npm_config_prefix) === path.resolve(env.npm_config_local_prefix ?? '')) {
    delete env.npm_config_prefix;
    delete env.npm_config_global_prefix;
}

let host;
try {
    host = path.join(execSync('npm root -g', { encoding: 'utf8', env }).trim(), 'openclaw');
} catch {
    host = undefined;
}
if (!host || !fs.existsSync(path.join(host, 'package.json'))) {
    console.log('link-openclaw: no global OpenClaw found (npm install -g openclaw); node_modules/openclaw left as it is.');
    process.exit(0);
}
const hostReal = fs.realpathSync(host);
if (fs.existsSync(target) && fs.realpathSync(target) === hostReal) process.exit(0);
fs.rmSync(target, { recursive: true, force: true });
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.symlinkSync(hostReal, target, 'junction');
const { version } = JSON.parse(fs.readFileSync(path.join(hostReal, 'package.json'), 'utf8'));
console.log(`link-openclaw: node_modules/openclaw -> ${hostReal} (${version})`);
