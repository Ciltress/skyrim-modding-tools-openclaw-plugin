/**
 * The coverage tasks (since 2026-11-08, the user's "create the eval tasks that discover gaps in tools or skills"): one
 * for each kind of mod object the main tasks leave out — ingredients, misc items, scrolls, food, poisons, spell tomes;
 * tempering, smelting and cooking recipes, outfits, leveled NPC and spell lists; classes, factions, AI packages,
 * followers and their voices; soul gems, keys, lights, form lists; scenes, messages, the story manager; statics, doors,
 * furniture, activators, flora, locations, encounter zones, regions; navmeshes indoors and out. Each asked plainly and in detail, as the main tasks
 * are, and held to what the game needs of the record, not to one way of writing it.
 *
 * They run as their own group, `--group coverage`, not in the main rounds: about 310 runs, a baseline that names the gaps
 * in the tools and skills; a task joins the main set once its gaps are closed. Their ground truth — the game's records
 * they name — is looked up when a check first needs it, so a main round's start pays nothing for them.
 *
 * `h` is eval.mjs's own: its readers of the project's files, the plugin's tools, and its checks.
 */
import fs from 'node:fs';
import path from 'node:path';

export function coverageTasks(h) {
    const ids = new Map();
    /** A game record's FormKey, lower-case, by its editor ID; undefined where the load order has none. */
    const idOf = editorId => {
        if (!ids.has(editorId)) {
            ids.set(editorId, h.callServerJson('findRecords', { records: [editorId], limit: 1 })
                .then(found => found.records.find(r => r.editorId?.toLowerCase() === editorId.toLowerCase())?.formId?.toLowerCase())
                .catch(() => undefined));
        }
        return ids.get(editorId);
    };
    /** Whether a link of a project's record names a game record, by its editor ID. */
    const names = async (project, link, editorId) => !!link && (await h.linkTarget(project, link))?.toLowerCase() === await idOf(editorId);
    /** The project's new record of a group whose in-game name matches. */
    const named = (project, group, name) => h.newRecords(project, group).find(r => name.test(h.nameOf(r.text)));
    /** A field's link, as written: `CreatedObject: IngotIron`, its comment left out. */
    const linkOf = (text, field) => new RegExp(`^[ \\t]*${field}:[ \\t]*([^\\s#{]+)`, 'm').exec(text ?? '')?.[1];
    /** The magic effects of a record's Effects, each with its own text — the project's or the game's — and numbers. */
    const effects = async (project, text) => Promise.all(h.effectItems(text ?? '').map(async item =>
        ({ ...item, text: await h.recordAnywhere(project, item.effect) ?? '' })));
    const av = value => new RegExp(`^[ \\t]+ActorValue:[ \\t]*${value}[ \\t]*\\r?$`, 'm');
    const resists = value => new RegExp(`^ResistValue:[ \\t]*${value}[ \\t]*\\r?$`, 'm');
    const DETRIMENTAL = /^[ \t]*-[ \t]*Detrimental[ \t]*\r?$|Flags:[ \t]*\[[^\]\r\n]*\bDetrimental\b/m;
    /** A record's keywords, each as a FormKey. */
    const keywords = async (project, text) => Promise.all(h.listOf(text ?? '', 'Keywords').map(async k => (await h.linkTarget(project, k))?.toLowerCase()));
    const hasKeyword = async (project, text, editorId) => (await keywords(project, text)).includes(await idOf(editorId));
    /** A recipe's materials, by editor ID with their counts. */
    const materials = async (project, text) => Promise.all(h.containerItems(text ?? '').map(async ({ link, count }) =>
        ({ id: (await h.editorIdOf(project, link))?.toLowerCase(), count })));
    const counts = (list, editorId) => list.filter(m => m.id === editorId.toLowerCase()).reduce((n, m) => n + (m.count || 0), 0);
    /** The project's copies of records of other plugins — its overrides. */
    const overridesOf = project => {
        const { plugin, records } = h.projectRecords(project);
        return records.filter(r => r.formKey && plugin && !r.formKey.toLowerCase().endsWith(`:${plugin.toLowerCase()}`));
    };
    /** The project's new recipes that make a record, by its editor ID — or, with `copies`, its copies of the game's. */
    const recipesFor = async (project, editorIds, copies = false) => {
        const wanted = editorIds.map(id => id.toLowerCase());
        const pool = copies ? overridesOf(project).filter(r => r.group === 'constructibleobjects') : h.newRecords(project, 'constructibleobjects');
        const all = await Promise.all(pool.map(async r =>
            ({ ...r, makes: (await h.editorIdOf(project, linkOf(r.text, 'CreatedObject')))?.toLowerCase() })));
        return all.filter(r => wanted.includes(r.makes));
    };
    /**
     * What the project places in a cell: each reference file in the cell's folder — under Cells/ or Worldspaces/, named for
     * the cell's editor ID or FormKey — with the base it places, as written, and its position.
     */
    const placedIn = async (project, cellEditorId) => {
        const cell = await idOf(cellEditorId);
        const key = cell?.replace(':', '_');
        return h.projectRecords(project).records
            .filter(r => (r.group === 'cells' || r.group === 'worldspaces') && !/RecordData\.yaml$/i.test(r.file)
                && (r.file.toLowerCase().includes(`/${cellEditorId.toLowerCase()} - `) || (key && r.file.toLowerCase().includes(key))))
            .map(r => ({ ...r, base: linkOf(r.text, 'Base'), position: h.positionOf(r.text) }));
    };
    /** Whether a cell has a reference whose base is the project's record. */
    const placesOwn = async (project, cellEditorId, record) => !!record &&
        (await placedIn(project, cellEditorId)).some(ref => ref.base && (ref.base.toLowerCase() === editorIdIn(record.text)?.toLowerCase()
            || ref.base.toLowerCase() === record.formKey?.toLowerCase()));
    const built = (project, calls) => h.builtProject(project, calls);
    /** A record file's EditorID line's value. */
    const editorIdIn = text => /^EditorID:[ \t]*(\S+)/m.exec(text ?? '')?.[1];
    /** The Papyrus sources of a project's scripts folder. */
    const scriptSources = project => {
        const dir = path.join(h.projectsDir(), project, 'scripts');
        return fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => /\.psc$/i.test(f)).map(f => fs.readFileSync(path.join(dir, f), 'utf8')) : [];
    };
    const nothingElse = project => h.noOverride(project);

    /** A task of the group: `check` and `detailedCheck` get the run, as the main tasks' do. */
    const task = (id, skill, prompt, detailed, check, detailedCheck) => ({
        id, group: 'coverage', skill, prompt, detailed, check,
        detailedCheck: async run => ({ ...await check(run), ...await detailedCheck(run) })
    });
    /** A task whose checks named are the plain ask's alone: the detailed ask does not ask for what they hold to. */
    const plainOnly = (t, keys) => ({
        ...t,
        detailedCheck: async run => Object.fromEntries(Object.entries(await t.detailedCheck(run)).filter(([key]) => !keys.includes(key)))
    });
    const ask = (mod, what) => `Make a new mod called ${mod} ${what} Build it, but do not deploy it.`;

    return [
        // ---- Items ----
        task('ingredient', 'skyrim-modding-items-and-crafting',
            ask('GlacialSalt', 'with a new ingredient named "Glacial Salt" that restores magicka and resists frost.'),
            ask('GlacialSalt', 'with a new ingredient named "Glacial Salt", made like Frost Salts — its model and sounds — with four ' +
                'effects: Restore Magicka, Resist Frost, Fortify Destruction and Weakness to Fire. It is worth 40 gold and weighs 0.25.'),
            async ({ calls }) => {
                const it = named('GlacialSalt', 'ingredients', /^glacial salt$/i);
                const all = await effects('GlacialSalt', it?.text);
                return {
                    newIngredient: !!it,
                    restoresMagicka: all.some(e => av('Magicka').test(e.text) && !DETRIMENTAL.test(e.text)),
                    resistsFrost: all.some(e => av('FrostResist|ResistFrost').test(e.text)),
                    modelInGame: !!it && await h.modelInGame('GlacialSalt', it.text),
                    noOverride: nothingElse('GlacialSalt'),
                    built: built('GlacialSalt', calls)
                };
            },
            async () => {
                const it = named('GlacialSalt', 'ingredients', /^glacial salt$/i);
                const all = await effects('GlacialSalt', it?.text);
                return {
                    fourEffects: all.length === 4,
                    fortifiesDestruction: all.some(e => av('DestructionModifier|DestructionPowerModifier').test(e.text)),
                    weakToFire: all.some(e => av('FireResist|ResistFire').test(e.text) && DETRIMENTAL.test(e.text)),
                    valueOf40: h.fieldIs(it?.text, 'Value', 40),
                    weightOf025: h.fieldIs(it?.text, 'Weight', '0?\\.25')
                };
            }),
        task('misc', 'skyrim-modding-items-and-crafting',
            ask('MothersLocket', 'with a new misc item, a locket named "Mother\'s Locket", worth 120 gold, that merchants buy.'),
            ask('MothersLocket', 'with a new misc item named "Mother\'s Locket", made like the game\'s Gold Ring\'s look where a misc ' +
                'item can have it — a model the game has — with a value of 120, a weight of 0.25 and the keyword VendorItemClutter.'),
            async ({ calls }) => {
                const it = named('MothersLocket', 'miscitems', /^mother'?s locket$/i);
                const kw = await keywords('MothersLocket', it?.text);
                const vendor = await Promise.all(['VendorItemClutter', 'VendorItemJewelry', 'VendorItemGems'].map(idOf));
                return {
                    newMiscItem: !!it,
                    valueOf120: h.fieldIs(it?.text, 'Value', 120),
                    sold: kw.some(k => vendor.includes(k)),
                    modelInGame: !!it && await h.modelInGame('MothersLocket', it.text),
                    noOverride: nothingElse('MothersLocket'),
                    built: built('MothersLocket', calls)
                };
            },
            async () => {
                const it = named('MothersLocket', 'miscitems', /^mother'?s locket$/i);
                return { weightOf025: h.fieldIs(it?.text, 'Weight', '0?\\.25'), clutterKeyword: await hasKeyword('MothersLocket', it?.text, 'VendorItemClutter') };
            }),
        task('scroll', 'skyrim-modding-magic',
            ask('ScrollOfStorms', 'with a new scroll named "Scroll of Storms" that, read, strikes a target with lightning.'),
            ask('ScrollOfStorms', 'with a new scroll named "Scroll of Storms", made like the game\'s scrolls — a scroll\'s model, cast ' +
                'once and aimed — with Lightning Bolt\'s shock damage effect at magnitude 30, a value of 60 and a weight of 0.5.'),
            async ({ calls }) => {
                const it = named('ScrollOfStorms', 'scrolls', /^scroll of storms$/i);
                const all = await effects('ScrollOfStorms', it?.text);
                return {
                    newScroll: !!it,
                    shockDamage: all.some(e => resists('ResistShock').test(e.text) && av('Health').test(e.text)),
                    firedOnce: /^CastType:[ \t]*(?:1|3|FireAndForget|Scroll)[ \t]*\r?$/m.test(it?.text ?? ''),
                    modelInGame: !!it && await h.modelInGame('ScrollOfStorms', it.text),
                    noOverride: nothingElse('ScrollOfStorms'),
                    built: built('ScrollOfStorms', calls)
                };
            },
            async () => {
                const it = named('ScrollOfStorms', 'scrolls', /^scroll of storms$/i);
                const all = await effects('ScrollOfStorms', it?.text);
                return {
                    aimed: /^TargetType:[ \t]*(?:2|Aimed)[ \t]*\r?$/m.test(it?.text ?? '') || all.length > 0 && all.every(e => /^TargetType:[ \t]*Aimed/m.test(e.text)),
                    magnitude30: all.some(e => resists('ResistShock').test(e.text) && e.magnitude === 30),
                    valueOf60: h.fieldIs(it?.text, 'Value', 60),
                    weightOf05: h.fieldIs(it?.text, 'Weight', '0?\\.5')
                };
            }),
        task('food', 'skyrim-modding-items-and-crafting',
            ask('HoneyBread', 'with a new food named "Honey Bread" that restores a little health when eaten.'),
            ask('HoneyBread', 'with a new food named "Honey Bread", made like the Sweetroll — its model and its eating sound — restoring ' +
                '10 health, with a value of 6, a weight of 0.5 and the keyword VendorItemFood.'),
            async ({ calls }) => {
                const it = named('HoneyBread', 'ingestibles', /^honey bread$/i);
                const all = await effects('HoneyBread', it?.text);
                return {
                    newFood: !!it,
                    eaten: h.flagged(it?.text, 'FoodItem'),
                    restoresHealth: all.some(e => av('Health').test(e.text) && !DETRIMENTAL.test(e.text)),
                    soldAsFood: await hasKeyword('HoneyBread', it?.text, 'VendorItemFood'),
                    modelInGame: !!it && await h.modelInGame('HoneyBread', it.text),
                    noOverride: nothingElse('HoneyBread'),
                    built: built('HoneyBread', calls)
                };
            },
            async () => {
                const it = named('HoneyBread', 'ingestibles', /^honey bread$/i);
                const all = await effects('HoneyBread', it?.text);
                return {
                    restores10: all.some(e => av('Health').test(e.text) && e.magnitude === 10),
                    eatingSound: !!linkOf(it?.text, 'ConsumeSound') && !(await names('HoneyBread', linkOf(it?.text, 'ConsumeSound'), 'ITMPotionUse')),
                    valueOf6: h.fieldIs(it?.text, 'Value', 6),
                    weightOf05: h.fieldIs(it?.text, 'Weight', '0?\\.5')
                };
            }),
        task('poison', 'skyrim-modding-items-and-crafting',
            ask('FrostbiteVenom', 'with a new poison named "Frostbite Venom" that deals frost damage to whoever the poisoned weapon hits.'),
            ask('FrostbiteVenom', 'with a new poison named "Frostbite Venom", made like the game\'s Weak Poison — its model and sounds — ' +
                'dealing 20 frost damage at once, with a value of 50 and the keyword VendorItemPoison.'),
            async ({ calls }) => {
                const it = named('FrostbiteVenom', 'ingestibles', /^frostbite venom$/i);
                const all = await effects('FrostbiteVenom', it?.text);
                return {
                    newPoison: !!it,
                    aPoison: h.flagged(it?.text, 'Poison'),
                    frostDamage: all.some(e => resists('ResistFrost').test(e.text) && av('Health').test(e.text) && DETRIMENTAL.test(e.text)),
                    modelInGame: !!it && await h.modelInGame('FrostbiteVenom', it.text),
                    noOverride: nothingElse('FrostbiteVenom'),
                    built: built('FrostbiteVenom', calls)
                };
            },
            async () => {
                const it = named('FrostbiteVenom', 'ingestibles', /^frostbite venom$/i);
                const all = await effects('FrostbiteVenom', it?.text);
                return {
                    damage20: all.some(e => resists('ResistFrost').test(e.text) && e.magnitude === 20),
                    valueOf50: h.fieldIs(it?.text, 'Value', 50),
                    poisonKeyword: await hasKeyword('FrostbiteVenom', it?.text, 'VendorItemPoison')
                };
            }),
        task('spelltome', 'skyrim-modding-magic',
            ask('TomeOfEmbers', 'with a new spell tome named "Spell Tome: Ember Bolt" that teaches the player the Firebolt spell when read.'),
            ask('TomeOfEmbers', 'with a new spell tome named "Spell Tome: Ember Bolt", made like Spell Tome: Flames — its model, its ' +
                'inventory art and its keywords — that teaches Firebolt when read, with a value of 100.'),
            async ({ calls }) => {
                const it = named('TomeOfEmbers', 'books', /^spell tome: ember bolt$/i);
                const teaches = h.blockOf(it?.text ?? '', 'Teaches');
                return {
                    newBook: !!it,
                    teachesFirebolt: /Spell/.test(teaches) && await names('TomeOfEmbers', /\bSpell:[ \t]*([^\s#]+)/.exec(teaches)?.[1], 'Firebolt'),
                    modelInGame: !!it && await h.modelInGame('TomeOfEmbers', it.text),
                    noOverride: nothingElse('TomeOfEmbers'),
                    built: built('TomeOfEmbers', calls)
                };
            },
            async () => {
                const it = named('TomeOfEmbers', 'books', /^spell tome: ember bolt$/i);
                return { valueOf100: h.fieldIs(it?.text, 'Value', 100), tomeKeyword: await hasKeyword('TomeOfEmbers', it?.text, 'VendorItemSpellTome') };
            }),

        // ---- Crafting and lists ----
        task('tempering', 'skyrim-modding-items-and-crafting',
            ask('TemperNordSword', 'that lets the player improve the Ancient Nord Sword at the grindstone with one iron ingot.'),
            ask('TemperNordSword', 'with a tempering recipe for the Ancient Nord Sword, made like the Iron Sword\'s — at the grindstone, ' +
                'with the conditions the game\'s tempering recipes have — from 1 Iron Ingot.'),
            async ({ calls }) => {
                const [own] = await recipesFor('TemperNordSword', h.truth.ancientNordSword.editorIds);
                // The game's own tempering recipe of the sword changed to one iron ingot is what the plain ask names too (the
                // user's call of 2026-11-09): every run of eval round 139 changed TemperWeaponDraugrSword so. That copy, and no other.
                const [copy] = own ? [] : await recipesFor('TemperNordSword', h.truth.ancientNordSword.editorIds, true);
                const recipe = own ?? copy;
                const mats = await materials('TemperNordSword', recipe?.text);
                const others = overridesOf('TemperNordSword').filter(r => r.file !== copy?.file);
                return {
                    temperRecipe: !!recipe,
                    atTheGrindstone: await names('TemperNordSword', linkOf(recipe?.text, 'WorkbenchKeyword'), 'CraftingSmithingSharpeningWheel'),
                    oneIronIngot: counts(mats, 'IngotIron') === 1 && mats.length === 1,
                    noOverride: own ? nothingElse('TemperNordSword') : others.length === 0,
                    built: built('TemperNordSword', calls)
                };
            },
            async () => {
                const [recipe] = await recipesFor('TemperNordSword', h.truth.ancientNordSword.editorIds);
                // The game's tempering recipes are shown only with the item improvable: EPTemperingItemIsEnchanted and the perk checks.
                return { newRecipe: !!recipe, hasConditions: h.entriesOf(recipe?.text ?? '', 'Conditions').length > 0 };
            }),
        task('smelting', 'skyrim-modding-items-and-crafting',
            ask('SmeltSilver', 'that lets the player melt a Silver Sword down into 2 silver ingots at the smelter.'),
            ask('SmeltSilver', 'with a smelter recipe, made like the game\'s smelting recipes — at the smelter — turning 1 Silver Sword ' +
                'into 2 Silver Ingots.'),
            async ({ calls }) => {
                const [recipe] = await recipesFor('SmeltSilver', ['IngotSilver']);
                const mats = await materials('SmeltSilver', recipe?.text);
                return {
                    smeltingRecipe: !!recipe,
                    atTheSmelter: await names('SmeltSilver', linkOf(recipe?.text, 'WorkbenchKeyword'), 'CraftingSmelter'),
                    fromASilverSword: counts(mats, 'SilverSword') === 1,
                    makesTwo: h.fieldIs(recipe?.text, 'CreatedObjectCount', 2),
                    noOverride: nothingElse('SmeltSilver'),
                    built: built('SmeltSilver', calls)
                };
            },
            async () => ({})),
        task('cooking', 'skyrim-modding-items-and-crafting',
            ask('PotatoSoup', 'that lets the player cook a Vegetable Soup at a cooking pot from 2 potatoes and 1 salt pile.'),
            ask('PotatoSoup', 'with a cooking recipe, made like the game\'s Vegetable Soup recipe — at the cooking pot — making 1 ' +
                'Vegetable Soup from 2 Potatoes and 1 Salt Pile.'),
            async ({ calls }) => {
                const [recipe] = await recipesFor('PotatoSoup', ['FoodVegetableSoup']);
                const mats = await materials('PotatoSoup', recipe?.text);
                return {
                    cookingRecipe: !!recipe,
                    atTheCookingPot: await names('PotatoSoup', linkOf(recipe?.text, 'WorkbenchKeyword'), 'CraftingCookpot'),
                    twoPotatoes: counts(mats, 'FoodPotato') === 2,
                    saltPile: counts(mats, 'SaltPile') === 1,
                    noOverride: nothingElse('PotatoSoup'),
                    built: built('PotatoSoup', calls)
                };
            },
            async () => ({})),
        task('outfit', 'skyrim-modding-npcs',
            ask('HunterOutfit', 'with a new NPC named "Brenna the Hunter" who wears hide armor, hide boots and hide bracers.'),
            ask('HunterOutfit', 'with a new outfit, HunterOutfit, of Hide Armor, Hide Boots and Hide Bracers, and a new NPC named ' +
                '"Brenna the Hunter" — a female Nord — who wears it as her default outfit.'),
            async ({ calls }) => {
                const npc = named('HunterOutfit', 'npcs', /^brenna the hunter$/i);
                const outfitLink = linkOf(npc?.text, 'DefaultOutfit');
                const outfit = outfitLink ? await h.recordAnywhere('HunterOutfit', outfitLink) : '';
                const items = await Promise.all(h.listOf(outfit ?? '', 'Items').map(async i => (await h.editorIdOf('HunterOutfit', i))?.toLowerCase()));
                return {
                    newNpc: !!npc,
                    wearsHide: ['armorhidecuirass', 'armorhideboots', 'armorhidegauntlets'].every(id => items.includes(id)),
                    built: built('HunterOutfit', calls)
                };
            },
            async () => {
                const npc = named('HunterOutfit', 'npcs', /^brenna the hunter$/i);
                return { ownOutfit: h.newRecords('HunterOutfit', 'outfits').length > 0 && !!npc && !!linkOf(npc.text, 'DefaultOutfit') };
            }),
        task('leveled-npc', 'skyrim-modding-leveled-lists',
            ask('IceWolves', 'in which wolves in the wild can also be ice wolves.'),
            ask('IceWolves', 'in which the leveled list wolves come from, LCharWolf, also holds the Ice Wolf at level 1, keeping ' +
                'everything it holds.'),
            async ({ calls }) => {
                const { checks, list } = await listGains('IceWolves', /wolf/i, ['EncWolfIce'], 'leveled-npc');
                return { ...checks, built: built('IceWolves', calls) };
            },
            async () => {
                const { list } = await listGains('IceWolves', /wolf/i, ['EncWolfIce'], 'leveled-npc');
                return { theWolfList: !!list && /^EditorID:[ \t]*LCharWolf[ \t]*\r?$/mi.test(list.text) };
            }),
        task('leveled-spell', 'skyrim-modding-leveled-lists',
            ask('BanditFrost', 'in which bandit mages can also cast Ice Spike.'),
            ask('BanditFrost', 'in which the leveled spell list LSpellBandit01FireFrostShock also holds the spell Ice Spike at level ' +
                '1, keeping everything it holds.'),
            async ({ calls }) => {
                const spells = ['IceSpike', 'IceSpikeLeftHand', 'IceSpikeRightHand'];
                const { checks } = await listGains('BanditFrost', /bandit/i, spells, 'leveled-spell');
                // Or each bandit mage's template given the spell, its own spells kept: the bandit mages take their spells from
                // the six EncBandit0<n>TemplateMagic (eval round 139's leveled-spell #1 copied five of them).
                const templates = checks.listChanged ? null : await templatesGain('BanditFrost', [1, 2, 3, 4, 5, 6].map(n => `EncBandit0${n}TemplateMagic`), spells);
                return templates ? { listChanged: templates.gained, keepsItsEntries: templates.kept, built: built('BanditFrost', calls) }
                    : { ...checks, built: built('BanditFrost', calls) };
            },
            async () => {
                const { list } = await listGains('BanditFrost', /bandit/i, ['IceSpike', 'IceSpikeLeftHand', 'IceSpikeRightHand'], 'leveled-spell');
                return { theBanditList: !!list && /^EditorID:[ \t]*LSpellBandit01FireFrostShock[ \t]*\r?$/mi.test(list.text) };
            }),

        // ---- Characters ----
        task('class', 'skyrim-modding-npcs',
            ask('SpellswordClass', 'with a new class named "Spellsword" for NPCs who fight with one-handed weapons and destruction magic.'),
            ask('SpellswordClass', 'with a new class named "Spellsword", made like the game\'s combat classes, whose highest skill ' +
                'weights are One-Handed and Destruction, and that trains One-Handed up to level 50.'),
            async ({ calls }) => {
                const it = named('SpellswordClass', 'classes', /^spellsword$/i);
                const weights = weightsOf(it?.text);
                const weight = skill => Object.entries(weights).find(([k]) => k.toLowerCase() === skill)?.[1] ?? 0;
                // Both at or above the second highest weight: a tie at the top favors them as well (eval round 139's class runs
                // weighted them alike with a third skill, and the first two of the sort were the others).
                const second = Object.values(weights).sort((a, b) => b - a)[1] ?? 0;
                return {
                    newClass: !!it,
                    favorsBoth: second > 0 && weight('onehanded') >= second && weight('destruction') >= second,
                    noOverride: nothingElse('SpellswordClass'),
                    built: built('SpellswordClass', calls)
                };
            },
            async () => {
                const it = named('SpellswordClass', 'classes', /^spellsword$/i);
                return {
                    teachesOneHanded: /^Teaches:[ \t]*(?:OneHanded|0)[ \t]*\r?$/m.test(it?.text ?? ''),
                    upTo50: h.fieldIs(it?.text, 'MaxTrainingLevel', 50)
                };
            }),
        task('faction', 'skyrim-modding-npcs',
            ask('AshBrotherhood', 'with a new faction named "Brotherhood of Ash", ranked Initiate and Elder, and a new NPC named ' +
                '"Vorstag the Ashen" who is its Elder.'),
            ask('AshBrotherhood', 'with a new faction named "Brotherhood of Ash" with two ranks, Initiate (0) and Elder (1), and a new ' +
                'NPC named "Vorstag the Ashen" — a male Dark Elf — who is in it at rank 1.'),
            async ({ calls }) => {
                const faction = named('AshBrotherhood', 'factions', /^brotherhood of ash$/i);
                const npc = named('AshBrotherhood', 'npcs', /^vorstag the ashen$/i);
                const ranks = [...h.blockOf(faction?.text ?? '', 'Ranks').matchAll(/^[ \t]+Value:[ \t]*(.+?)[ \t]*\r?$/gm)].map(m => m[1]);
                const member = h.entriesOf(npc?.text ?? '', 'Factions').map(item => ({
                    link: /\bFaction:[ \t]*([^\s#]+)/.exec(item)?.[1], rank: Number(/\bRank:[ \t]*(-?\d+)/.exec(item)?.[1] ?? 0)
                }));
                const own = faction && (await Promise.all(member.map(async m => ({ ...m, key: (await h.linkTarget('AshBrotherhood', m.link))?.toLowerCase() }))))
                    .find(m => m.key === faction.formKey?.toLowerCase());
                return {
                    newFaction: !!faction,
                    twoRanks: ranks.some(r => /initiate/i.test(r)) && ranks.some(r => /elder/i.test(r)),
                    newNpc: !!npc,
                    isTheElder: !!own && own.rank === 1,
                    built: built('AshBrotherhood', calls)
                };
            },
            async () => ({})),
        task('package', 'skyrim-modding-npcs',
            ask('BanneredMareRegular', 'with a new NPC named "Old Hroki" who spends his days in the Bannered Mare in Whiterun, sitting ' +
                'and eating there.'),
            ask('BanneredMareRegular', 'with a new NPC named "Old Hroki", placed in the Bannered Mare, with an AI package of the mod\'s ' +
                'own that has him sandbox in the Bannered Mare, made from the game\'s Sandbox package template.'),
            async ({ calls }) => {
                const npc = named('BanneredMareRegular', 'npcs', /^old hroki$/i);
                const packages = await Promise.all(h.listOf(npc?.text ?? '', 'Packages').map(p => h.recordAnywhere('BanneredMareRegular', p)));
                const sandbox = await idOf('Sandbox');
                const sandboxes = [];
                for (const p of packages) if (p && (await h.linkTarget('BanneredMareRegular', linkOf(p, 'PackageTemplate')))?.toLowerCase() === sandbox) sandboxes.push(p);
                return {
                    newNpc: !!npc,
                    placedThere: await placesOwn('BanneredMareRegular', 'WhiterunBanneredMare', npc),
                    sandboxes: sandboxes.length > 0,
                    built: built('BanneredMareRegular', calls)
                };
            },
            // A package of the mod's own is the detailed ask's alone: plainly asked, a game package of the Sandbox template the
            // NPC lists does the same (eval round 139's package runs).
            async () => {
                const npc = named('BanneredMareRegular', 'npcs', /^old hroki$/i);
                const listed = await Promise.all(h.listOf(npc?.text ?? '', 'Packages').map(async p => (await h.linkTarget('BanneredMareRegular', p))?.toLowerCase()));
                const sandbox = await idOf('Sandbox');
                const own = [];
                for (const p of h.newRecords('BanneredMareRegular', 'packages'))
                    if (listed.includes(p.formKey?.toLowerCase()) && (await h.linkTarget('BanneredMareRegular', linkOf(p.text, 'PackageTemplate')))?.toLowerCase() === sandbox) own.push(p);
                return { ownSandbox: own.length > 0 };
            }),
        task('follower', 'skyrim-modding-npcs',
            ask('RiverwoodFollower', 'with a new follower named "Sigrid Stormhand" in Riverwood\'s Sleeping Giant Inn, whom the player ' +
                'can ask to follow them.'),
            ask('RiverwoodFollower', 'with a new NPC named "Sigrid Stormhand" — a female Nord warrior, placed in the Sleeping Giant Inn ' +
                '— whom the player can recruit as the game\'s followers are: in PotentialFollowerFaction and CurrentFollowerFaction ' +
                '(rank -1), with a voice type that has follower lines, such as FemaleEvenToned.'),
            async ({ calls }) => {
                const npc = named('RiverwoodFollower', 'npcs', /^sigrid stormhand$/i);
                const factions = await Promise.all(h.entriesOf(npc?.text ?? '', 'Factions').map(async item =>
                    (await h.linkTarget('RiverwoodFollower', /\bFaction:[ \t]*([^\s#]+)/.exec(item)?.[1]))?.toLowerCase()));
                const voice = (await h.editorIdOf('RiverwoodFollower', linkOf(npc?.text, 'Voice')))?.toLowerCase();
                return {
                    newNpc: !!npc,
                    recruitable: factions.includes(await idOf('PotentialFollowerFaction')),
                    followerVoice: FOLLOWER_VOICES.includes(voice ?? ''),
                    placedInTheInn: await placesOwn('RiverwoodFollower', 'RiverwoodSleepingGiantInn', npc),
                    built: built('RiverwoodFollower', calls)
                };
            },
            async () => {
                const npc = named('RiverwoodFollower', 'npcs', /^sigrid stormhand$/i);
                const current = await idOf('CurrentFollowerFaction');
                const items = await Promise.all(h.entriesOf(npc?.text ?? '', 'Factions').map(async item => ({
                    key: (await h.linkTarget('RiverwoodFollower', /\bFaction:[ \t]*([^\s#]+)/.exec(item)?.[1]))?.toLowerCase(),
                    rank: Number(/\bRank:[ \t]*(-?\d+)/.exec(item)?.[1] ?? 0)
                })));
                return { currentFollowerAtMinus1: items.some(i => i.key === current && i.rank === -1) };
            }),

        // ---- Soul gems, keys, lights, form lists ----
        task('soulgem', 'skyrim-modding-items-and-crafting',
            ask('StarShard', 'with a new soul gem named "Star Shard" that can hold grand souls.'),
            ask('StarShard', 'with a new soul gem named "Star Shard", made like the Grand Soul Gem — its model and keywords — empty, ' +
                'holding up to a grand soul, with a value of 300.'),
            async ({ calls }) => {
                const it = named('StarShard', 'soulgems', /^star shard$/i);
                return {
                    newSoulGem: !!it,
                    holdsGrand: /^MaximumCapacity:[ \t]*Grand[ \t]*\r?$/m.test(it?.text ?? ''),
                    modelInGame: !!it && await h.modelInGame('StarShard', it.text),
                    noOverride: nothingElse('StarShard'),
                    built: built('StarShard', calls)
                };
            },
            async () => {
                const it = named('StarShard', 'soulgems', /^star shard$/i);
                return { empty: !/^ContainedSoul:[ \t]*(?!None)\w+/m.test(it?.text ?? ''), valueOf300: h.fieldIs(it?.text, 'Value', 300) };
            }),
        task('key', 'skyrim-modding-world',
            ask('CellarKey', 'with a new locked chest in Breezehome and a new key named "Cellar Key" that opens it.'),
            ask('CellarKey', 'with a new key named "Cellar Key" and a chest of the mod\'s own placed in Breezehome\'s main room, locked ' +
                'at the Expert level, that the Cellar Key opens.'),
            async ({ calls }) => {
                const key = named('CellarKey', 'keys', /^cellar key$/i);
                const refs = await placedIn('CellarKey', 'WhiterunBreezehome');
                const locked = [];
                for (const ref of refs) {
                    const lock = h.blockOf(ref.text, 'Lock');
                    const opener = /\bKey:[ \t]*([^\s#]+)/.exec(lock)?.[1];
                    if (key && opener && (await h.linkTarget('CellarKey', opener))?.toLowerCase() === key.formKey?.toLowerCase()) locked.push(lock);
                }
                return { newKey: !!key, lockedByIt: locked.length > 0, keyModelInGame: !!key && await h.modelInGame('CellarKey', key.text), built: built('CellarKey', calls) };
            },
            async () => {
                const refs = await placedIn('CellarKey', 'WhiterunBreezehome');
                return { expertLock: refs.some(ref => /\bLevel:[ \t]*(?:Expert|75)\b/.test(h.blockOf(ref.text, 'Lock'))) };
            }),
        task('light', 'skyrim-modding-world',
            ask('FrostLight', 'that lights Breezehome\'s main room with a cold blue light.'),
            ask('FrostLight', 'with a new light of the mod\'s own, a blue one with a radius of 512, placed in Breezehome\'s main room.'),
            async ({ calls }) => {
                const lights = h.newRecords('FrostLight', 'lights');
                const refs = await placedIn('FrostLight', 'WhiterunBreezehome');
                const placedLights = [];
                for (const ref of refs) {
                    const text = ref.base ? await h.recordAnywhere('FrostLight', ref.base) : '';
                    if (text && /^Radius:/m.test(text)) placedLights.push(text);
                }
                return {
                    aLightPlaced: placedLights.length > 0,
                    blue: placedLights.some(text => isBlue(/^Color:[ \t]*['"]?(#?[0-9A-Fa-f]{6,8})/m.exec(text)?.[1])),
                    ownLight: lights.length > 0,
                    built: built('FrostLight', calls)
                };
            },
            async () => {
                const lights = h.newRecords('FrostLight', 'lights');
                return { radius512: lights.some(l => h.fieldIs(l.text, 'Radius', 512)) };
            }),
        task('formlist', 'skyrim-modding-settings',
            ask('SilverWeaponList', 'with a new form list holding the game\'s silver weapons: the Silver Sword and the Silver Greatsword.'),
            ask('SilverWeaponList', 'with a new form list, SilverWeaponsList, holding the Silver Sword and the Silver Greatsword, and ' +
                'nothing else.'),
            async ({ calls }) => {
                const lists = h.newRecords('SilverWeaponList', 'formlists');
                const items = await Promise.all(lists.flatMap(l => h.listOf(l.text, 'Items')).map(async i => (await h.editorIdOf('SilverWeaponList', i))?.toLowerCase()));
                return {
                    newFormList: lists.length > 0,
                    holdsBoth: items.includes('silversword') && items.includes('silvergreatsword'),
                    noOverride: nothingElse('SilverWeaponList'),
                    built: built('SilverWeaponList', calls)
                };
            },
            async () => {
                const list = h.newRecords('SilverWeaponList', 'formlists').find(l => /^EditorID:[ \t]*SilverWeaponsList[ \t]*\r?$/mi.test(l.text));
                return { namedSo: !!list, onlyThose: !!list && h.listOf(list.text, 'Items').length === 2 };
            }),

        // ---- Scenes, messages, the story manager ----
        task('scene', 'skyrim-modding-quests-and-scripts',
            ask('InnChatter', 'with a scene in which Hulda and Ysolda talk in the Bannered Mare: Hulda says "Business is slow today." ' +
                'and Ysolda answers "It will pick up when the caravans come."'),
            ask('InnChatter', 'with a quest of its own that starts with the game and holds a scene: two aliases filled with Hulda and ' +
                'Ysolda, and two dialogue actions in order — Hulda says "Business is slow today.", then Ysolda says "It will pick up ' +
                'when the caravans come."'),
            async ({ calls }) => {
                const scenes = h.newRecords('InnChatter', 'scenes');
                const lines = h.projectRecords('InnChatter').records.map(r => r.text).join('\n');
                return {
                    newScene: scenes.length > 0,
                    twoActors: scenes.some(s => h.entriesOf(s.text, 'Actors').length >= 2),
                    bothLines: /Business is slow today/i.test(lines) && /pick up when the caravans come/i.test(lines),
                    built: built('InnChatter', calls)
                };
            },
            async () => {
                const quests = h.newRecords('InnChatter', 'quests');
                const huldaYsolda = [];
                for (const q of quests) {
                    const aliases = h.blockOf(q.text, 'Aliases');
                    const links = [...aliases.matchAll(/\b(?:UniqueActor|ForcedReference|Npc|Object):[ \t]*([^\s#]+)/g)].map(m => m[1]);
                    for (const link of links) huldaYsolda.push((await h.editorIdOf('InnChatter', link))?.toLowerCase());
                }
                return {
                    startsWithTheGame: quests.some(q => h.flagged(q.text, 'StartGameEnabled')),
                    aliasesFilled: huldaYsolda.includes('hulda') && huldaYsolda.includes('ysolda')
                };
            }),
        task('message', 'skyrim-modding-quests-and-scripts',
            ask('WelcomeMessage', 'that shows the player a message box saying "Welcome to Skyrim, traveler!" when a new game starts.'),
            ask('WelcomeMessage', 'with a message of its own — a message box, not a notification — saying "Welcome to Skyrim, ' +
                'traveler!" with an OK button, shown by the script of a quest of its own that starts with the game.'),
            async ({ calls }) => {
                const messages = h.newRecords('WelcomeMessage', 'messages').filter(m => /Welcome to Skyrim, traveler/i.test(m.text));
                const sources = scriptSources('WelcomeMessage');
                return {
                    newMessage: messages.length > 0,
                    aMessageBox: messages.some(m => h.flagged(m.text, 'MessageBox')),
                    shown: sources.some(s => /\.Show\s*\(/i.test(s)),
                    built: built('WelcomeMessage', calls)
                };
            },
            async () => {
                const messages = h.newRecords('WelcomeMessage', 'messages');
                return {
                    okButton: messages.some(m => /\bOK\b/i.test(h.blockOf(m.text, 'MenuButtons'))),
                    startsWithTheGame: h.newRecords('WelcomeMessage', 'quests').some(q => h.flagged(q.text, 'StartGameEnabled'))
                };
            }),
        plainOnly(task('storymanager', 'skyrim-modding-quests-and-scripts',
            ask('ArrivalRumor', 'with a quest the story manager starts each time the player arrives in a new location.'),
            ask('ArrivalRumor', 'with a quest of its own, started by the story manager on the Change Location event: a quest node ' +
                'of the mod\'s own under the game\'s Change Location event branch that names the quest.'),
            async ({ calls }) => {
                const quests = h.newRecords('ArrivalRumor', 'quests');
                const nodes = h.newRecords('ArrivalRumor', 'storymanagerquestnodes');
                const named = [];
                for (const n of nodes) for (const q of h.entriesOf(n.text, 'Quests')) named.push((await h.linkTarget('ArrivalRumor', /\bQuest:[ \t]*([^\s#]+)/.exec(q)?.[1]))?.toLowerCase());
                return {
                    newQuest: quests.length > 0,
                    questNode: nodes.length > 0,
                    nodeNamesIt: quests.some(q => named.includes(q.formKey?.toLowerCase())),
                    // The Change Location event's code, as the game's quests started on it have it (DA09ChangeLocation).
                    onChangeLocation: quests.some(q => /^Event:[ \t]*CLOC[ \t]*\r?$/m.test(q.text)),
                    // Each time: the story manager starts a quest only while it is stopped, and never again one that runs once —
                    // eval round 139's storymanager #3 passed with a quest that showed its message once and ran on.
                    startsAgain: quests.some(q => !h.listOf(q.text, 'Flags').some(f => /RunOnce/i.test(f)))
                        && scriptSources('ArrivalRumor').some(s => /\bStop\s*\(\s*\)/i.test(s.replace(/;.*$/gm, ''))),
                    built: built('ArrivalRumor', calls)
                };
            },
            async () => ({})), ['startsAgain']),

        // ---- The world's objects ----
        task('static', 'skyrim-modding-world',
            ask('BreezehomeStatue', 'that places a new statue — a static object of the mod\'s own — in Breezehome\'s main room.'),
            ask('BreezehomeStatue', 'with a new static of its own, a statue made like the game\'s statics — its model one the game has ' +
                '— placed standing on the floor of Breezehome\'s main room.'),
            async ({ calls }) => {
                const statics = h.newRecords('BreezehomeStatue', 'statics');
                const placed = [];
                for (const s of statics) if (await placesOwn('BreezehomeStatue', 'WhiterunBreezehome', s)) placed.push(s);
                return {
                    newStatic: statics.length > 0,
                    placed: placed.length > 0,
                    modelInGame: placed.length > 0 && await h.modelInGame('BreezehomeStatue', placed[0].text),
                    built: built('BreezehomeStatue', calls)
                };
            },
            async () => ({})),
        task('door', 'skyrim-modding-world',
            ask('BreezehomeCellar', 'with a cellar under Breezehome — a new interior cell — that a new door in Breezehome leads to.'),
            ask('BreezehomeCellar', 'with a new interior cell, "Breezehome Cellar", and a door in Breezehome\'s main room and one in ' +
                'the cellar, each teleporting to the other, so the player walks between them.'),
            async ({ calls }) => {
                const cells = h.projectRecords('BreezehomeCellar').records.filter(r => r.group === 'cells' && /RecordData\.yaml$/i.test(r.file)
                    && r.formKey && !/:(?:skyrim|update|dawnguard|hearthfires|dragonborn)\.esm$/i.test(r.formKey));
                const refs = h.projectRecords('BreezehomeCellar').records.filter(r => r.group === 'cells' && /\bTeleport(?:Destination)?:/.test(r.text));
                return {
                    newCell: cells.length > 0,
                    teleportDoors: refs.length >= 2,
                    built: built('BreezehomeCellar', calls)
                };
            },
            async () => {
                const cells = h.projectRecords('BreezehomeCellar').records.filter(r => r.group === 'cells' && /RecordData\.yaml$/i.test(r.file));
                return { named: cells.some(c => /^breezehome cellar$/i.test(h.nameOf(c.text))), interior: cells.some(c => h.flagged(c.text, 'IsInteriorCell')) };
            }),
        task('furniture', 'skyrim-modding-world',
            ask('ReadingChair', 'with a new chair named "Reading Chair", placed in Breezehome\'s main room, that the player can sit in.'),
            ask('ReadingChair', 'with a new furniture record named "Reading Chair", made like the game\'s chair WoodenChair01 — its model and ' +
                'sitting markers — placed in Breezehome\'s main room.'),
            async ({ calls }) => {
                const chair = named('ReadingChair', 'furniture', /^reading chair$/i);
                return {
                    newFurniture: !!chair,
                    sittable: !!chair && h.entriesOf(chair.text, 'Markers').length > 0,
                    placed: await placesOwn('ReadingChair', 'WhiterunBreezehome', chair),
                    modelInGame: !!chair && await h.modelInGame('ReadingChair', chair.text),
                    built: built('ReadingChair', calls)
                };
            },
            async () => ({})),
        task('activator', 'skyrim-modding-world',
            ask('GoldLever', 'with a new lever in Breezehome that gives the player 100 gold when pulled.'),
            ask('GoldLever', 'with a new activator named "Strange Lever", made like the game\'s levers — a lever\'s model — with a ' +
                'script of its own whose OnActivate gives the player 100 gold, placed in Breezehome\'s main room.'),
            async ({ calls }) => {
                const acts = h.newRecords('GoldLever', 'activators');
                const sources = scriptSources('GoldLever');
                const placed = [];
                for (const a of acts) if (await placesOwn('GoldLever', 'WhiterunBreezehome', a)) placed.push(a);
                return {
                    newActivator: acts.length > 0,
                    scripted: acts.some(a => h.blockOf(a.text, 'VirtualMachineAdapter').length > 0),
                    givesGold: sources.some(s => /Event\s+OnActivate/i.test(s) && /AddItem\s*\(/i.test(s) && /\b100\b/.test(s)),
                    placed: placed.length > 0,
                    built: built('GoldLever', calls)
                };
            },
            async () => ({ named: !!named('GoldLever', 'activators', /^strange lever$/i) })),
        task('flora', 'skyrim-modding-world',
            ask('Moonpetal', 'with a new plant, "Moonpetal", growing outside Riverwood, that the player can pick for a new ingredient, ' +
                '"Moonpetal Leaf".'),
            ask('Moonpetal', 'with a new ingredient named "Moonpetal Leaf" and a new flora named "Moonpetal", made like the game\'s ' +
                'Blue Mountain Flower plant — its model and harvest sound — that gives the leaf when picked, placed on the ground in ' +
                'an exterior cell of Riverwood.'),
            async ({ calls }) => {
                const plant = named('Moonpetal', 'florae', /^moonpetal$/i) ?? h.newRecords('Moonpetal', 'florae')[0];
                const leaf = named('Moonpetal', 'ingredients', /^moonpetal leaf$/i);
                const gives = plant && leaf && (await h.linkTarget('Moonpetal', linkOf(plant.text, 'Ingredient')))?.toLowerCase() === leaf.formKey?.toLowerCase();
                const placed = h.projectRecords('Moonpetal').records.filter(r => r.group === 'worldspaces' && /Riverwood/i.test(r.file) && linkOf(r.text, 'Base'));
                return {
                    newFlora: !!plant,
                    newIngredient: !!leaf,
                    givesTheLeaf: !!gives,
                    placedOutside: placed.length > 0,
                    built: built('Moonpetal', calls)
                };
            },
            async () => ({})),
        task('location', 'skyrim-modding-world',
            ask('AshenCamp', 'with a new interior cell, "Ashen Camp", that the game knows as a location of its own in Whiterun Hold.'),
            ask('AshenCamp', 'with a new location named "Ashen Camp", whose parent location is WhiterunHoldLocation and which has ' +
                'the keyword LocTypeDwelling, and a new interior cell of the same name whose location it is.'),
            async ({ calls }) => {
                const location = named('AshenCamp', 'locations', /^ashen camp$/i);
                const cells = h.projectRecords('AshenCamp').records.filter(r => r.group === 'cells' && /RecordData\.yaml$/i.test(r.file));
                const inIt = [];
                for (const c of cells) if (location && (await h.linkTarget('AshenCamp', linkOf(c.text, 'Location')))?.toLowerCase() === location.formKey?.toLowerCase()) inIt.push(c);
                return {
                    newLocation: !!location,
                    inWhiterunHold: await names('AshenCamp', linkOf(location?.text, 'ParentLocation'), 'WhiterunHoldLocation'),
                    cellInIt: inIt.length > 0,
                    built: built('AshenCamp', calls)
                };
            },
            async () => {
                const location = named('AshenCamp', 'locations', /^ashen camp$/i);
                return { dwelling: await hasKeyword('AshenCamp', location?.text, 'LocTypeDwelling') };
            }),
        task('encounterzone', 'skyrim-modding-world',
            ask('DangerousEmbershard', 'in which the enemies of Embershard Mine, near Riverwood, are at least level 20.'),
            ask('DangerousEmbershard', 'with a new encounter zone of its own, levels 20 to 40, set on the Embershard Mine cell, EmbershardMine01.'),
            async ({ calls }) => {
                const { zone } = await mineZone('DangerousEmbershard');
                return {
                    // The mine's cell given another zone, or the zone it has changed: EmbershardMineZone is the mine's, and every
                    // plain run of eval round 139 raised its levels so.
                    mineChanged: !!copyNamed('DangerousEmbershard', 'EmbershardMine01') || !!copyNamed('DangerousEmbershard', 'EmbershardMineZone'),
                    zoneAtLeast20: Number(/^MinLevel:[ \t]*(\d+)/m.exec(zone ?? '')?.[1] ?? 0) >= 20,
                    built: built('DangerousEmbershard', calls)
                };
            },
            async () => {
                const { key } = await mineZone('DangerousEmbershard');
                const zones = h.newRecords('DangerousEmbershard', 'encounterzones');
                const own = zones.find(z => z.formKey?.toLowerCase() === key);
                return { ownZone: !!own, upTo40: !!own && h.fieldIs(own.text, 'MaxLevel', 40) && h.fieldIs(own.text, 'MinLevel', 20) };
            }),
        task('region', 'skyrim-modding-world',
            ask('SnowyRiverwood', 'that makes it snow around Riverwood.'),
            ask('SnowyRiverwood', 'with a new region of its own over Riverwood\'s cells in Tamriel, whose weather is the game\'s snow ' +
                'weather SkyrimOvercastSnow at chance 100.'),
            async ({ calls }) => {
                const regions = h.newRecords('SnowyRiverwood', 'regions');
                const named = await riverwoodRegions();
                // A new region with an area, or a game region Riverwood's cell names, its weather made snow: eval round 139's
                // region #3 changed WeatherPineForest so.
                const copies = overridesOf('SnowyRiverwood').filter(r => r.group === 'regions' && named.includes(r.formKey?.toLowerCase()));
                const over = [...regions.filter(r => h.entriesOf(r.text, 'RegionAreas').length > 0), ...copies];
                const weathers = h.projectRecords('SnowyRiverwood').records.filter(r => r.group === 'weathers').map(r => r.text).join('\n');
                return {
                    overRiverwood: over.length > 0,
                    snowWeather: over.some(r => /Snow/i.test(r.text)) || (over.length > 0 && /Snow/i.test(weathers)),
                    built: built('SnowyRiverwood', calls),
                    // Unscored until a game test says whether it takes it: the game's cells name their regions in their own
                    // Regions list, and a new region is named in none of the game's.
                    facts: { namedInRiverwoodCells: await namedInCells('SnowyRiverwood', regions) }
                };
            },
            async () => {
                const regions = h.newRecords('SnowyRiverwood', 'regions');
                return {
                    newRegion: regions.length > 0,
                    hasArea: regions.some(r => h.entriesOf(r.text, 'RegionAreas').length > 0)
                };
            }),

        // ---- Navmeshes (generateNavmesh, since 2026-11-08) ----
        task('navmesh', 'skyrim-modding-world',
            ask('InnNavmesh', 'that gives the Sleeping Giant Inn in Riverwood a navmesh made anew from what stands in it.'),
            ask('InnNavmesh', 'with the navmesh of the Sleeping Giant Inn, RiverwoodSleepingGiantInn, generated anew from its objects\' ' +
                'collision, its door linked, so its NPCs walk it.'),
            async ({ calls }) => {
                const files = navmeshFiles('InnNavmesh');
                return {
                    generated: calls.some(c => c.name === 'generateNavmesh' && !c.isError),
                    innNavmesh: files.some(f => /RiverwoodSleepingGiantInn - 0133C6_Skyrim\.esm\/NavigationMeshes\/0539F3_Skyrim\.esm\.yaml$/i.test(f.file)),
                    built: built('InnNavmesh', calls)
                };
            },
            async () => ({
                doorLinked: navmeshFiles('InnNavmesh').some(f => /^[ \t]*DoorTriangles:/m.test(f.text) && /Door:[ \t]*013419:Skyrim\.esm/i.test(f.text))
            })),
        task('navmesh-outdoor', 'skyrim-modding-world',
            ask('RiverwoodHill', 'that raises a small hill in Riverwood and makes Riverwood\'s navmesh fit the new ground.'),
            ask('RiverwoodHill', 'that raises the ground by 150 units within 300 units of 17400, -47600 in Tamriel, in Riverwood, then ' +
                'makes the navmesh of the Riverwood cell anew, so NPCs walk the new ground.'),
            async ({ calls }) => {
                const done = name => calls.map((c, i) => c.name === name && !c.isError ? i : -1).filter(i => i >= 0);
                const terrain = done('editTerrain');
                const navmesh = done('generateNavmesh');
                const files = navmeshFiles('RiverwoodHill');
                return {
                    groundRaised: terrain.length > 0,
                    navmeshAfter: terrain.length > 0 && navmesh.some(i => i > Math.max(...terrain)),
                    riverwoodNavmesh: files.some(f => /\/Riverwood - 009732_Skyrim\.esm\/NavigationMeshes\//i.test(f.file)),
                    built: built('RiverwoodHill', calls)
                };
            },
            async ({ calls }) => ({
                // The edit asked: a raise of 150 around 17400, -47600.
                raisedThere: calls.some(c => c.name === 'editTerrain' && !c.isError && c.args?.action === 'raise'
                    && Math.abs(Number(c.args?.amount) - 150) < 1 && /^\s*17[34]\d\d(?:\.\d+)?\s*,\s*-47[56]\d\d/.test(String(c.args?.at ?? '')))
            }))
    ];

    /** The navmesh files of a project: each record file in a cell's NavigationMeshes folder. */
    function navmeshFiles(project) {
        return h.projectRecords(project).records.filter(r => /\/NavigationMeshes\/[^/]+\.yaml$/i.test(r.file.replace(/\\/g, '/')))
            .map(r => ({ ...r, file: r.file.replace(/\\/g, '/') }));
    }

    /**
     * A leveled list's copy that holds a record now: of the project's copies of the game's lists whose editor ID matches,
     * the one holding it — directly or through a list of the project's own — and whether it keeps every entry the game's has.
     */
    async function listGains(project, idPattern, editorIds, kind) {
        const group = kind === 'leveled-npc' ? 'levelednpcs' : 'leveledspells';
        const { plugin, records } = h.projectRecords(project);
        const own = records.filter(r => r.group === group && plugin && r.formKey?.toLowerCase().endsWith(`:${plugin.toLowerCase()}`));
        const copies = records.filter(r => r.group === group && r.formKey && plugin && !r.formKey.toLowerCase().endsWith(`:${plugin.toLowerCase()}`)
            && idPattern.test(/^EditorID:[ \t]*(\S+)/m.exec(r.text)?.[1] ?? ''));
        const wanted = (await Promise.all(editorIds.map(idOf))).filter(Boolean);
        const resolve = list => Promise.all(list.map(async e => ({ ...e, formKey: (await h.linkTarget(project, e.reference))?.toLowerCase() })));
        const holdsIt = async (text, depth = 0) => {
            for (const e of await resolve(h.leveledEntries(text))) {
                if (wanted.includes(e.formKey)) return true;
                const inner = depth < 3 && own.find(r => r.formKey?.toLowerCase() === e.formKey);
                if (inner && await holdsIt(inner.text, depth + 1)) return true;
            }
            return false;
        };
        let list;
        for (const copy of copies) if (await holdsIt(copy.text)) { list = copy; break; }
        let keeps = false;
        if (list) {
            try {
                const read = await h.callServerJson('readRecord', { record: list.formKey });
                keeps = h.keepsEntries(await resolve(h.leveledEntries(list.text)), await resolve(h.leveledEntries(read.versions[0].files.map(f => f.text).join('\n'))));
            } catch { /* a list the load order has not */ }
        }
        return { list, checks: { listChanged: !!list, keepsItsEntries: keeps } };
    }

    /** Whether the project copies each of the game's NPCs named, each copy holding one of the spells and the spells it had. */
    async function templatesGain(project, editorIds, spells) {
        const wanted = (await Promise.all(spells.map(idOf))).filter(Boolean);
        const spellsOf = text => Promise.all(h.listOf(text ?? '', 'ActorEffect').map(async s => (await h.linkTarget(project, s))?.toLowerCase()));
        let gained = true, kept = true;
        for (const editorId of editorIds) {
            const copy = copyNamed(project, editorId);
            if (!copy) return { gained: false, kept: false };
            const now = await spellsOf(copy.text);
            if (!now.some(s => wanted.includes(s))) gained = false;
            try {
                const read = await h.callServerJson('readRecord', { record: copy.formKey });
                if (!(await spellsOf(read.versions[0].files.map(f => f.text).join('\n'))).every(s => now.includes(s))) kept = false;
            } catch { kept = false; }
        }
        return { gained, kept };
    }

    /** The zone Embershard Mine's cell has with the project: its copy's, or the game's — and that zone's text, the project's copy first. */
    async function mineZone(project) {
        const cell = copyNamed(project, 'EmbershardMine01');
        let link = linkOf(cell?.text, 'EncounterZone');
        if (!cell) {
            try {
                link = linkOf((await h.callServerJson('readRecord', { record: 'EmbershardMine01' })).versions[0].files.map(f => f.text).join('\n'), 'EncounterZone');
            } catch { /* a load order without the mine */ }
        }
        return { key: link ? (await h.linkTarget(project, link))?.toLowerCase() : undefined, zone: link ? await h.recordAnywhere(project, link) : '' };
    }

    /** The regions the game's Riverwood cell names, as FormKeys. */
    let riverwood;
    async function riverwoodRegions() {
        riverwood ??= h.callServerJson('readRecord', { record: 'Riverwood' })
            .then(read => Promise.all(h.listOf(read.versions[0].files.map(f => f.text).join('\n'), 'Regions')
                .map(async r => (await h.linkTarget('SnowyRiverwood', r))?.toLowerCase())))
            .catch(() => []);
        return riverwood;
    }

    /** Whether the project's copy of the Riverwood cell names one of the regions in its Regions list. */
    async function namedInCells(project, regions) {
        const cell = copyNamed(project, 'Riverwood');
        if (!cell || regions.length === 0) return false;
        const named = await Promise.all(h.listOf(cell.text, 'Regions').map(async r => (await h.linkTarget(project, r))?.toLowerCase()));
        return regions.some(r => named.includes(r.formKey?.toLowerCase()));
    }

    /** The project's copy of a game record, by its editor ID: a file of the record's FormKey. */
    function copyNamed(project, editorId) {
        return h.projectRecords(project).records.find(r => r.formKey && new RegExp(`^EditorID:[ \\t]*${editorId}[ \\t]*\\r?$`, 'mi').test(r.text));
    }

    /** A class's skill weights, by skill. */
    function weightsOf(text) {
        return Object.fromEntries(h.entriesOf(text ?? '', 'SkillWeights').map(item =>
            [/\bKey:[ \t]*(\w+)/.exec(item)?.[1] ?? '', Number(/\bValue:[ \t]*(\d+)/.exec(item)?.[1] ?? 0)]).filter(([k]) => k));
    }
}

/** The voice types the game's follower lines are recorded for. */
const FOLLOWER_VOICES = ['femaleevenToned', 'femalecommander', 'femaleyoungeager', 'femalesultry', 'femalenord', 'femaleargonian',
    'femaleorc', 'femalekhajiit', 'femalecondescending', 'femaledarkelf', 'femaleshrill', 'maleeventoned', 'maleeventonedaccented',
    'malecommander', 'maleyoungeager', 'malenord', 'malebrute', 'maleargonian', 'maleorc', 'malekhajiit', 'maledarkelf',
    'maledrunk', 'malecondescending', 'malesoldier', 'malecommoner'].map(v => v.toLowerCase());

/** Whether a light's colour, as Spriggit writes it (`#AARRGGBB` or `#RRGGBB`), is mostly blue. */
function isBlue(color) {
    if (!color) return false;
    const hex = color.replace('#', '');
    const rgb = hex.length === 8 ? hex.slice(2) : hex;
    const [r, g, b] = [0, 2, 4].map(i => parseInt(rgb.slice(i, i + 2), 16));
    return b > r && b >= g * 0.9 && b >= 120;
}
