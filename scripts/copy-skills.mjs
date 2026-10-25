// Brings skills/ in step with the core's skills, which openclaw.plugin.json ships: the core owns them (core-first),
// the plugin serves them. Runs as part of npm run build; skills/ is not committed.
//
// In place, never by deleting the folder first: the gateway watches it, and a root that disappears under its
// watcher is logged as "root path changed during operation". Files the core no longer has are removed one by one.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(root, 'package.json'));
const core = path.dirname(require.resolve('skyrim-modding-tools-core/package.json'));
const from = path.join(core, 'skills');
const to = path.join(root, 'skills');

const files = dir => fs.existsSync(dir)
    ? fs.readdirSync(dir, { recursive: true, withFileTypes: true }).filter(e => e.isFile())
        .map(e => path.relative(dir, path.join(e.parentPath, e.name)))
    : [];

let written = 0;
for (const file of files(from)) {
    const source = path.join(from, file);
    const target = path.join(to, file);
    const content = fs.readFileSync(source);
    if (fs.existsSync(target) && fs.readFileSync(target).equals(content)) continue;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
    written++;
}
const wanted = new Set(files(from));
let removed = 0;
for (const file of files(to)) {
    if (!wanted.has(file)) { fs.rmSync(path.join(to, file)); removed++; }
}
const count = files(to).filter(file => path.basename(file) === 'SKILL.md').length;
console.log(`copy-skills: ${count} skills from ${from} (${written} written, ${removed} removed)`);
