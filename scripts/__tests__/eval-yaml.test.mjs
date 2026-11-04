import { lineShape, textValue, translatedValue } from '../eval-yaml.mjs';

/** A note's text as the eval reads it: word for word for its score, line for line for its recorded facts. */

const note = (...value) => ['EditorID: MavenNote_MavenWarning', 'BookText:', '  TargetLanguage: English', ...value,
    'PickUpSound: 0C7A54:Skyrim.esm  # ITMNoteUp'].join('\n');

describe('textValue', () => {
    it('reads a literal block line for line, an empty line one empty line', () => {
        expect(textValue(note('  Value: |-', '    <font face="$HandwrittenFont">Indaryn,', '', '    If you dare again.', '',
            '    Maven'), 'BookText')).toBe('<font face="$HandwrittenFont">Indaryn,\n\nIf you dare again.\n\nMaven');
    });

    it('reads a folded block as YAML folds it: two blank lines an empty line, one a line break, none a space', () => {
        expect(textValue(note('  Value: >-', '    Indaryn,', '', '', '    If you dare', '    again.', '', '    Maven'), 'BookText'))
            .toBe('Indaryn,\n\nIf you dare again.\nMaven');
    });

    it('keeps the line breaks beside a line indented deeper than a folded block', () => {
        expect(textValue(note('  Value: >-', '    Lines:', '      one', '      two', '    end'), 'BookText'))
            .toBe('Lines:\n  one\n  two\nend');
    });

    it('decodes a double-quoted text, its CRLF line ends read as LF', () => {
        expect(textValue(note('  Value: "by \\r\\nWaughin Jarth\\r\\n\\r\\nThe end"'), 'BookText'))
            .toBe('by \nWaughin Jarth\n\nThe end');
    });

    it('reads a plain and a single-quoted text', () => {
        expect(textValue('Name: Iron Sword', 'Name')).toBe('Iron Sword');
        expect(textValue("Name:\n  TargetLanguage: English\n  Value: 'Spell Tome: Storm Bolt'", 'Name')).toBe('Spell Tome: Storm Bolt');
    });

    it('answers undefined for a field the file does not have', () => {
        expect(textValue(note('  Value: Hi'), 'Description')).toBeUndefined();
    });
});

describe('lineShape and translatedValue', () => {
    it('tells a note with its empty lines from one without, where translatedValue reads the two as the same', () => {
        const kept = note('  Value: |-', '    Indaryn,', '', '    If you dare again.', '', '    Maven');
        const lost = note('  Value: >-', '    Indaryn,', '', '    If you dare again.', '', '    Maven');
        expect(lineShape(textValue(kept, 'BookText'))).toBe('x-x-x');
        expect(lineShape(textValue(lost, 'BookText'))).toBe('xxx');
        expect(translatedValue(kept, 'BookText')).toBe(translatedValue(lost, 'BookText'));
    });
});
