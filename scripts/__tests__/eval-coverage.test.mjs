import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { coverageTasks } from '../eval-coverage.mjs';

/**
 * The coverage tasks' checks run on a run that made nothing: each answers with its checks, none throws. Eval round 141's
 * region check read a cache declared below the task list's return, never set, and threw on all six runs, whose mods were
 * built and right.
 */

const projectsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eval-coverage-test-'));
afterAll(() => fs.rmSync(projectsDir, { recursive: true, force: true }));

/** The eval's readers and checks, as they answer for a project with no records and a load order that has none of them. */
const empty = {
    callServerJson: async name => (name === 'findRecords' ? { records: [] } : { versions: [{ files: [] }] }),
    newRecords: () => [], projectRecords: () => ({ records: [] }), nameOf: () => '', fieldIs: () => false, flagged: () => false,
    listOf: () => [], blockOf: () => '', entriesOf: () => [], linkTarget: async () => undefined, editorIdOf: () => undefined,
    recordAnywhere: async () => '', effectItems: () => [], modelInGame: async () => false, noOverride: () => true,
    builtProject: () => false, containerItems: () => [], leveledEntries: () => [], keepsEntries: () => false,
    positionOf: () => undefined, projectsDir: () => projectsDir, truth: { ancientNordSword: { editorIds: [] } }
};

describe('coverageTasks', () => {
    const tasks = coverageTasks(empty);

    it.each(tasks.map(t => [t.id, t]))('%s: its checks answer for a run that made nothing', async (_, t) => {
        const run = { calls: [], answer: '', stop: 'answered', turns: [] };
        const plain = await t.check(run);
        expect(Object.keys(plain).length).toBeGreaterThan(0);
        if (t.detailedCheck) expect(Object.keys(await t.detailedCheck(run)).length).toBeGreaterThan(0);
    });
});
