import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareGridMeasures, layoutGridRows, formatGridChord } from '../dist/chordGrid.js';
import { resolvePreferences, validateChoices, parsePreferences, serializePreferences, refreshFileVoices } from '../dist/preferences.js';

const measure = (start, chords = [], extra = {}) => ({ start, duration: 4, chords, annotations: [], barStart: '|', barEnd: '|', ...extra });
const chord = (time, text) => ({ time, text });

test('display chord parts preserve harmony while formatting extensions and slash basses', () => {
  for (const [source, expected] of [
    ['Bm7b5', { root: 'B', suffix: 'm7(\u266d5)' }],
    ['C#m7b5', { root: 'C\u266f', suffix: 'm7(\u266d5)' }],
    ['D/F#', { root: 'D', suffix: '', bass: 'F\u266f' }],
    ['Cm6/Eb', { root: 'C', suffix: 'm6', bass: 'E\u266d' }],
    ['Bb7(b9#11)/Ab', { root: 'B\u266d', suffix: '7(\u266d9\u266f11)', bass: 'A\u266d' }],
    ['C6/9', { root: 'C', suffix: '6/9' }],
    ['G7b9', { root: 'G', suffix: '7(\u266d9)' }],
    ['F#dim7', { root: 'F\u266f', suffix: 'dim7' }],
    ['Cadd9', { root: 'C', suffix: 'add9' }],
    ['Cmaj7', { root: 'C', suffix: 'maj7' }],
    ['B\u00f87', { root: 'B', suffix: '\u00f87' }],
    ['A', { root: 'A', suffix: '' }],
    ['F\u266f7/C\u266f', { root: 'F\u266f', suffix: '7', bass: 'C\u266f' }]
  ]) assert.deepEqual(formatGridChord(source), expected, source);
  for (const source of ['N.C.', '%', 'Bridge', 'Coda', '(C7)', 'C7/H', 'C7\nG7', '<img src=x>', '']) {
    assert.equal(formatGridChord(source), undefined, source);
  }
});

test('harmonic continuation and normalized repeated measures preserve authored events without mutation', () => {
  const input = [
    measure(0), measure(4, [chord(0, 'C')]), measure(8),
    measure(12, [chord(0, 'C'), chord(2, 'C')]), measure(16, [chord(2, 'G')])
  ];
  const before = structuredClone(input);
  const result = prepareGridMeasures(input, true);
  assert.deepEqual(result.map(item => item.repeat), [false, false, true, true, false]);
  assert.deepEqual(result[0].chords, []);
  assert.deepEqual(result[2].chords, [chord(0, 'C')]);
  assert.deepEqual(result[4].chords, [chord(0, 'C'), chord(2, 'G')]);
  assert.deepEqual(input, before);
  assert.ok(prepareGridMeasures(input, false).every(item => !item.repeat));
});

test('durations, beat positions, repeat boundaries and endings prevent incorrect %', () => {
  const input = [
    measure(0, [chord(0, 'C'), chord(2, 'G')]),
    measure(4, [chord(0, 'C'), chord(1, 'G')]),
    measure(8, [chord(0, 'C'), chord(1, 'G')], { duration: 3 }),
    measure(11, [chord(0, 'C'), chord(1, 'G')], { duration: 3, barStart: '|:' }),
    measure(14, [chord(0, 'C'), chord(1, 'G')], { duration: 3, annotations: [{ time: 0, text: '1.', kind: 'ending' }] })
  ];
  assert.ok(prepareGridMeasures(input, true).every(item => !item.repeat));
});

test('text and navigation remain visible on repeated measures; N.C. is preserved', () => {
  const input = [
    measure(0, [chord(0, 'N.C.')]),
    measure(4, [], { annotations: [{ time: 1, text: 'Fine', kind: 'navigation' }] })
  ];
  const result = prepareGridMeasures(input, true);
  assert.equal(result[1].repeat, true);
  assert.equal(result[1].chords[0].text, 'N.C.');
  assert.equal(result[1].annotations[0].text, 'Fine');
});

test('source layout keeps lines, compact layout wraps, structural boundaries always split', () => {
  const measures = [measure(0), measure(4), measure(8, [], { sourceBreak: true }), measure(12, [], { sectionBreak: true })];
  assert.deepEqual(layoutGridRows(measures, [100, 100, 100, 100], 150, 'source'), [[0, 1], [2], [3]]);
  assert.deepEqual(layoutGridRows(measures, [100, 100, 100, 100], 250, 'compact'), [[0, 1], [2], [3]]);
  assert.deepEqual(layoutGridRows(measures, [500, 100, 100, 100], 50, 'compact'), [[0], [1], [2], [3]]);
  assert.deepEqual(layoutGridRows([], [], 100, 'source'), []);
  assert.throws(() => layoutGridRows(measures, [], 100, 'source'), /Invalid/);
  assert.throws(() => prepareGridMeasures([measure(0, [chord(4, 'C')])], true), /inside/);
});

test('grid settings are global, source is per file, old preferences have compatible defaults', () => {
  const legacy = resolvePreferences({ version: 1 }, 'a.abc');
  assert.deepEqual(legacy.chordGrid, { layout: 'source', repeatMeasures: true, showTextInstructions: false });
  const preferences = { version: 1, defaults: { chordGrid: { layout: 'compact', repeatMeasures: false, showTextInstructions: true } }, files: { 'a.abc': { chordSourceVoiceId: 'lead', tempo: 75 } } };
  assert.deepEqual(parsePreferences(serializePreferences(preferences)), preferences);
  const effective = resolvePreferences(preferences, 'a.abc');
  assert.equal(effective.chordGrid.layout, 'compact');
  assert.equal(effective.chordGrid.showTextInstructions, true);
  assert.equal(resolvePreferences({ version: 1, defaults: { chordGrid: { repeatMeasures: false } } }, 'a.abc').chordGrid.showTextInstructions, false);
  assert.equal(effective.chordSourceVoiceId, 'lead');
  assert.equal(effective.tempo, 75);
  assert.throws(() => validateChoices({ chordGrid: {} }), /Unknown/);
  assert.throws(() => validateChoices({ chordSourceVoiceId: 'lead' }, false), /Unknown/);
  assert.throws(() => validateChoices({ chordSourceVoiceId: '' }), /nonempty/);
  assert.throws(() => validateChoices({ chordGrid: { layout: 'invalid' } }, false), /source or compact/);
  assert.throws(() => validateChoices({ chordGrid: { repeatMeasures: 1 } }, false), /boolean/);
  assert.throws(() => validateChoices({ chordGrid: { showTextInstructions: 'true' } }, false), /boolean/);
  assert.throws(() => validateChoices({ chordGrid: { showTextInstructions: true } }), /Unknown/);
  assert.throws(() => validateChoices({ chordGrid: { typo: true } }, false), /Unknown/);
  const saved = preferences.files['a.abc'];
  assert.equal(refreshFileVoices(saved, effective, [{ id: 'lead', name: 'Renamed' }]).chordSourceVoiceId, 'lead');
  assert.equal(refreshFileVoices(saved, effective, [{ id: 'new' }]).chordSourceVoiceId, undefined);
  assert.equal(saved.chordSourceVoiceId, 'lead');
});

test('pickups are omitted without losing structure, canonical timing or following harmony', () => {
  const input = [
    measure(0, [chord(0, 'G')], { duration: 1, pickup: true, sourceBreak: true, barStart: '|:', annotations: [
      { time: 0, text: 'A', kind: 'part' }, { time: 0.5, text: 'D.S.', kind: 'navigation' }
    ] }),
    measure(1), measure(5, [chord(0, 'C')]),
    measure(9, [], { duration: 1, pickup: true, sectionBreak: true, annotations: [{ time: 0, text: 'B', kind: 'part' }] }),
    measure(10, [chord(0, 'Dm')]), measure(14, [chord(0, 'F')], { duration: 1, pickup: true }),
    measure(15)
  ];
  const before = structuredClone(input);
  for (const repeatMeasures of [false, true]) {
    const result = prepareGridMeasures(input, repeatMeasures);
    assert.deepEqual(result.map(measure => measure.start), [1, 5, 10, 15]);
    assert.ok(result.every(measure => !measure.pickup && measure.duration === 4 && !measure.repeat));
    assert.equal(result[0].chords[0].text, 'G');
    assert.equal(result[0].barStart, '|:');
    assert.equal(result[0].sourceBreak, true);
    assert.deepEqual(result[0].annotations, [{ time: 0, text: 'A', kind: 'part' }, { time: 0, text: 'D.S.', kind: 'navigation' }]);
    assert.equal(result[2].annotations[0].text, 'B');
    assert.equal(result[2].sectionBreak, true);
    assert.equal(result[2].chords[0].text, 'Dm');
    assert.equal(result[3].chords[0].text, 'F');
  }
  assert.deepEqual(input, before);
});
