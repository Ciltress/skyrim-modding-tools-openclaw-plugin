import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { publishedPackage, shipsCoreFile, stage, unnoticedPackages } from '../stage-clawhub.mjs';

/**
 * The package ClawHub publishes: the plugin with the core bundled and its helper built, since ClawHub installs with
 * npm install --ignore-scripts and a github: core would arrive without dist/ or helper.
 */

const DEPS = {
    libraries: {
        'SkyrimHelper/1.0.0': { type: 'project' },
        'Mutagen.Bethesda.Skyrim/0.54.0': { type: 'package' },
        'YamlDotNet/18.1.0': { type: 'package' }
    }
};
const NOTICES = '| Package | Version | License | Source |\n|---|---|---|---|\n' +
    '| Mutagen.Bethesda.Skyrim | 0.54.0 | GPL-3.0-only | https://github.com/Mutagen-Modding/Mutagen |\n' +
    '| YamlDotNet | 18.1.0 | MIT | https://github.com/aaubry/YamlDotNet |\n';

const PLUGIN_PACKAGE = {
    name: 'skyrim-modding-tools',
    version: '0.2.0',
    private: true,
    files: ['dist/*.js', 'skills', 'openclaw.plugin.json', 'README.md', 'THIRD_PARTY_NOTICES.md'],
    scripts: { build: 'tsc', postinstall: 'node scripts/link-openclaw.mjs' },
    dependencies: { 'skyrim-modding-tools-core': 'github:Ciltress/skyrim-modding-tools-core#v0.1.16' },
    devDependencies: { vitest: '^5.0.4' },
    peerDependencies: { openclaw: '>=2026.10.7' },
    openclaw: { extensions: ['./dist/index.js'] },
    allowScripts: { 'github:Ciltress/skyrim-modding-tools-core#1226add': true }
};

describe('publishedPackage', () => {
    it('bundles the core at its exact version and drops what only a checkout uses', () => {
        expect(publishedPackage(PLUGIN_PACKAGE, '0.1.16')).toEqual({
            name: 'skyrim-modding-tools',
            version: '0.2.0',
            private: true,
            files: ['dist/*.js', 'skills', 'openclaw.plugin.json', 'README.md', 'THIRD_PARTY_NOTICES.md'],
            dependencies: { 'skyrim-modding-tools-core': '0.1.16' },
            bundleDependencies: ['skyrim-modding-tools-core'],
            peerDependencies: { openclaw: '>=2026.10.7' },
            openclaw: { extensions: ['./dist/index.js'] }
        });
    });
});

describe('shipsCoreFile', () => {
    it('ships what runs: the code, the guides, the skills and the built helper', () => {
        for (const file of ['package.json', 'dist/index.js', 'docs/MCP-Tools.md', 'skills/Domain/skills/x/SKILL.md',
            'helper/bin/SkyrimHelper.dll', 'helper/bin/SkyrimHelper.exe', 'helper/bin/SkyrimHelper']) {
            expect(shipsCoreFile(file), file).toBe(true);
        }
    });

    it('leaves out the tests, the helper\'s sources and build, its symbols and anything installed', () => {
        for (const file of ['dist/__tests__/tools.test.js', 'helper/SkyrimHelper/Program.cs',
            'helper/SkyrimHelper/obj/Debug/x.dll', 'helper/bin/SkyrimHelper.pdb', 'node_modules/x/index.js']) {
            expect(shipsCoreFile(file), file).toBe(false);
        }
    });
});

describe('unnoticedPackages', () => {
    it('names each package the helper ships that the notices miss at its version', () => {
        expect(unnoticedPackages(DEPS, NOTICES)).toEqual([]);
        expect(unnoticedPackages(DEPS, NOTICES.replace('| 18.1.0 |', '| 17.0.0 |'))).toEqual(['YamlDotNet 18.1.0']);
    });
});

describe('stage', () => {
    let dir;
    let root;
    let core;

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stage-clawhub-test-'));
        root = path.join(dir, 'plugin');
        core = path.join(root, 'node_modules', 'skyrim-modding-tools-core');
        const files = {
            'package.json': JSON.stringify(PLUGIN_PACKAGE),
            'dist/index.js': 'export {};',
            'dist/__tests__/entry.test.js': '',
            'skills/Domain/skills/x/SKILL.md': '# x',
            'openclaw.plugin.json': '{}',
            'README.md': '# plugin',
            'LICENSE': 'GPL',
            'THIRD_PARTY_NOTICES.md': NOTICES,
            'node_modules/skyrim-modding-tools-core/package.json': JSON.stringify({ name: 'skyrim-modding-tools-core', version: '0.1.16' }),
            'node_modules/skyrim-modding-tools-core/dist/index.js': 'export {};',
            'node_modules/skyrim-modding-tools-core/dist/__tests__/x.test.js': '',
            'node_modules/skyrim-modding-tools-core/helper/bin/SkyrimHelper.dll': 'dll',
            'node_modules/skyrim-modding-tools-core/helper/bin/SkyrimHelper.exe': 'exe',
            'node_modules/skyrim-modding-tools-core/helper/bin/SkyrimHelper.pdb': 'pdb',
            'node_modules/skyrim-modding-tools-core/helper/bin/SkyrimHelper.deps.json': JSON.stringify(DEPS),
            'launchers/SkyrimHelper': 'elf'
        };
        for (const [file, text] of Object.entries(files)) {
            fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
            fs.writeFileSync(path.join(root, file), text);
        }
    });

    afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

    const listed = folder => fs.readdirSync(folder, { recursive: true, withFileTypes: true }).filter(entry => entry.isFile())
        .map(entry => path.relative(folder, path.join(entry.parentPath, entry.name)).split(path.sep).join('/')).sort();

    it('lays the package out with the core bundled and both launchers, the other system\'s given', () => {
        const staged = stage(root, [path.join(root, 'launchers', 'SkyrimHelper')]);
        expect(staged).toBe(path.join(root, 'stage'));
        expect(listed(staged)).toEqual([
            'LICENSE', 'README.md', 'THIRD_PARTY_NOTICES.md', 'dist/index.js',
            'node_modules/skyrim-modding-tools-core/dist/index.js',
            'node_modules/skyrim-modding-tools-core/helper/bin/SkyrimHelper',
            'node_modules/skyrim-modding-tools-core/helper/bin/SkyrimHelper.deps.json',
            'node_modules/skyrim-modding-tools-core/helper/bin/SkyrimHelper.dll',
            'node_modules/skyrim-modding-tools-core/helper/bin/SkyrimHelper.exe',
            'node_modules/skyrim-modding-tools-core/package.json',
            'openclaw.plugin.json', 'package.json', 'skills/Domain/skills/x/SKILL.md'
        ]);
        const published = JSON.parse(fs.readFileSync(path.join(staged, 'package.json'), 'utf8'));
        expect(published.dependencies).toEqual({ 'skyrim-modding-tools-core': '0.1.16' });
        expect(published.bundleDependencies).toEqual(['skyrim-modding-tools-core']);
    });

    it('stages anew: nothing of an earlier stage stays', () => {
        stage(root, [path.join(root, 'launchers', 'SkyrimHelper')]);
        fs.writeFileSync(path.join(root, 'stage', 'stale.txt'), '');
        expect(listed(stage(root, [path.join(root, 'launchers', 'SkyrimHelper')]))).not.toContain('stale.txt');
    });

    it('refuses a helper without a launcher for each system', () => {
        expect(() => stage(root, [])).toThrow(/helper\/bin\/SkyrimHelper is missing/);
    });

    it('refuses a helper that ships a package the notices do not name', () => {
        fs.writeFileSync(path.join(root, 'THIRD_PARTY_NOTICES.md'), NOTICES.replace(/\| YamlDotNet .*\n/, ''));
        expect(() => stage(root, [path.join(root, 'launchers', 'SkyrimHelper')])).toThrow(/YamlDotNet 18\.1\.0/);
    });

    it('refuses a plugin that is not built', () => {
        fs.rmSync(path.join(root, 'dist'), { recursive: true });
        expect(() => stage(root, [path.join(root, 'launchers', 'SkyrimHelper')])).toThrow(/npm run build/);
    });
});
