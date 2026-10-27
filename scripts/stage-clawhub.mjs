// Stages the package ClawHub publishes in stage/ and packs it into out/: the plugin as npm pack ships it, with
// skyrim-modding-tools-core bundled and its helper built. ClawHub installs with npm install --ignore-scripts, so a
// github: core would arrive without its dist/ or helper, and the plugin would not load.
//
// Needs npm run build, the helper built here (npm run build:helper), and the other system's launcher given as
// --launcher <file>. The release workflow builds SkyrimHelper.exe on Windows and packs on Linux: a pack made on Windows
// loses the Linux launcher's executable bit.
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const CORE = 'skyrim-modding-tools-core';
/** The helper's launcher on each system: the core starts the one of the system it runs on. */
const LAUNCHERS = ['SkyrimHelper.exe', 'SkyrimHelper'];
/** ClawHub's limit on a package, unpacked. */
const CLAWHUB_LIMIT = 50 * 1024 * 1024;

/** The published package.json: the core by its exact version, bundled; none of a checkout's scripts or dev tools. */
export function publishedPackage(pkg, coreVersion) {
    const { scripts, devDependencies, allowScripts, ...published } = pkg;
    return { ...published, dependencies: { ...pkg.dependencies, [CORE]: coreVersion }, bundleDependencies: [CORE] };
}

/**
 * Whether a file of the installed core, by its path from the core's folder, goes into the package: what runs — its
 * code, guides, skills and built helper — but not its tests, the helper's sources or build, or its symbols.
 */
export function shipsCoreFile(file) {
    return !/^(dist\/__tests__|helper\/SkyrimHelper|node_modules)(\/|$)/.test(file) && !file.endsWith('.pdb');
}

/** The packages the helper ships, from its deps.json, that the notices' table does not name at their version. */
export function unnoticedPackages(deps, notices) {
    return Object.entries(deps.libraries)
        .filter(([, library]) => library.type === 'package')
        .map(([key]) => key.split('/'))
        .filter(([id, version]) => !notices.includes(`| ${id} | ${version} |`))
        .map(([id, version]) => `${id} ${version}`);
}

/** Lays the package out in <root>/stage, anew, and answers that folder. `launchers` are added to the helper. */
export function stage(root, launchers) {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    const core = path.join(root, 'node_modules', CORE);
    const staged = path.join(root, 'stage');
    const stagedCore = path.join(staged, 'node_modules', CORE);
    const helper = path.join(stagedCore, 'helper', 'bin');
    if (!fs.existsSync(path.join(root, 'dist', 'index.js'))) throw new Error('The plugin is not built: run npm run build first.');
    if (!fs.existsSync(path.join(core, 'helper', 'bin', 'SkyrimHelper.dll'))) {
        throw new Error('The helper is not built: run npm run build:helper first.');
    }

    fs.rmSync(staged, { recursive: true, force: true });
    // What npm pack would ship of the plugin, `files` and LICENSE.
    for (const file of [...pkg.files.flatMap(pattern => fs.globSync(pattern, { cwd: root })), 'LICENSE']) {
        fs.cpSync(path.join(root, file), path.join(staged, file), { recursive: true });
    }
    fs.cpSync(core, stagedCore, {
        recursive: true,
        filter: source => shipsCoreFile(path.relative(core, source).split(path.sep).join('/'))
    });
    for (const launcher of launchers) fs.copyFileSync(launcher, path.join(helper, path.basename(launcher)));
    for (const launcher of LAUNCHERS) {
        if (!fs.existsSync(path.join(helper, launcher))) {
            throw new Error(`helper/bin/${launcher} is missing: build the helper on that system and give it as --launcher <file>.`);
        }
    }
    fs.chmodSync(path.join(helper, 'SkyrimHelper'), 0o755);

    const deps = JSON.parse(fs.readFileSync(path.join(helper, 'SkyrimHelper.deps.json'), 'utf8'));
    const unnoticed = unnoticedPackages(deps, fs.readFileSync(path.join(root, 'THIRD_PARTY_NOTICES.md'), 'utf8'));
    if (unnoticed.length) throw new Error(`THIRD_PARTY_NOTICES.md does not name what the helper ships: ${unnoticed.join(', ')}.`);

    const { version } = JSON.parse(fs.readFileSync(path.join(core, 'package.json'), 'utf8'));
    fs.writeFileSync(path.join(staged, 'package.json'), JSON.stringify(publishedPackage(pkg, version), null, 2) + '\n');
    return staged;
}

if (import.meta.main) {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const { values } = parseArgs({ options: { launcher: { type: 'string', multiple: true, default: [] } } });
    try {
        const staged = stage(root, values.launcher.map(file => path.resolve(file)));
        const out = path.join(root, 'out');
        fs.mkdirSync(out, { recursive: true });
        // One command line: npm is npm.cmd on Windows, which only a shell starts.
        const [pack] = JSON.parse(execSync(`npm pack --json --ignore-scripts --pack-destination "${out}"`, { cwd: staged, encoding: 'utf8' }));
        const mb = bytes => (bytes / 1024 / 1024).toFixed(1);
        console.log(`stage-clawhub: out/${pack.filename}, ${pack.entryCount} files, ${mb(pack.size)} MB, ` +
            `${mb(pack.unpackedSize)} MB unpacked of ClawHub's ${mb(CLAWHUB_LIMIT)}`);
        if (pack.unpackedSize > CLAWHUB_LIMIT) throw new Error('The package is larger than ClawHub takes.');
        if (process.platform === 'win32') {
            console.warn('stage-clawhub: packed on Windows, so helper/bin/SkyrimHelper is not executable in it: publish ' +
                'the pack the release workflow makes on Linux.');
        }
    } catch (error) {
        console.error(`stage-clawhub failed: ${error.message}`);
        process.exitCode = 1;
    }
}
