// Writes openclaw.plugin.json from the built plugin: OpenClaw reads it before it loads any plugin code, so the
// tools it names have to be the ones the plugin registers. manifest.test.ts holds the committed file to the same
// output. Run after npm run build.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { renderManifest } = await import(pathToFileURL(path.join(root, 'dist', 'manifest.js')).href);
const target = path.join(root, 'openclaw.plugin.json');
const rendered = renderManifest();
const previous = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
fs.writeFileSync(target, rendered);
console.log(`${previous === rendered ? 'unchanged' : 'written'}: openclaw.plugin.json`);
