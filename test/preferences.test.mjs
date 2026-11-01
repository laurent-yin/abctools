import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePreferences, serializePreferences, resolvePreferences, resolveVoiceFilter, validateChoices, voiceNotation, refreshFileVoices, wildcardMatches } from '../dist/preferences.js';
import { assembleAbcText } from '../dist/configText.js';
import { getEffectiveAbcConfig } from '../dist/abcTools.js';
import { assembleRawAbc } from '../dist/assemble.js';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const voices = [{ id: 'melody' }, { id: 'bass' }];
test('simple default exclusions match IDs and names without regex semantics', () => {
  const named = [{ id: 'lead', name: 'Melody' }, { id: 'low', name: 'Bass Counterpoint' }];
  for (const [pattern, expected] of [['', ['lead', 'low']], ['*BASS*', ['lead']], ['l?w', ['lead']], ['*', []], ['missing', ['lead', 'low']], ['[low]', ['lead', 'low']]]) {
    assert.deepEqual(resolveVoiceFilter({ hideVoicesMatching: pattern }, named).ids, expected);
  }
  assert.equal(wildcardMatches('*a*a*a*b', 'a'.repeat(1000)), false);
  assert.deepEqual(resolveVoiceFilter({ selectedVoiceIds: [] }, named).ids, []);
  assert.deepEqual(resolveVoiceFilter({ selectedVoiceIds: ['low'], hideVoicesMatching: '*' }, named).ids, ['low']);
});
test('semicolon-separated wildcard exclusions combine matches and ignore blank entries', () => {
  const named = [{ id: 'lead', name: 'Melody' }, { id: 'low', name: 'Bass' }, { id: 'counter', name: 'Counterpoint' }];
  for (const [pattern, expected] of [
    [' *BASS* ; counter* ; ', ['lead']],
    ['; ;  ', ['lead', 'low', 'counter']],
    ['missing; lead', ['low', 'counter']],
    ['low; low', ['lead', 'counter']],
    ['missing; *', []]
  ]) assert.deepEqual(resolveVoiceFilter({ hideVoicesMatching: pattern }, named).ids, expected);
});
test('instrument notation inherits default then file key, with voice overrides isolated to their file', () => {
  const preferences = { version: 1, defaults: { notation: { instrumentKey: 'Bb' } }, files: {
    'one.abc': { notation: { instrumentKey: 'Eb', voices: { bass: { instrumentKey: 'C' } } }, transposition: { semitones: 2 } }
  } };
  const one = resolvePreferences(preferences, 'one.abc');
  assert.equal(voiceNotation(one.notation, 'melody').instrumentKey, 'Eb');
  assert.equal(voiceNotation(one.notation, 'bass').instrumentKey, 'C');
  const two = resolvePreferences(preferences, 'two.abc');
  assert.equal(voiceNotation(two.notation, 'bass').instrumentKey, 'Bb');
  assert.equal(two.transposition.semitones, 0);
  delete preferences.files['one.abc'].notation.instrumentKey;
  assert.equal(voiceNotation(resolvePreferences(preferences, 'one.abc').notation, 'melody').instrumentKey, 'Bb');
});
test('file inventory refresh keeps surviving choices, defaults new voices and drops stale notation', () => {
  const choices = {
    display: { selectedVoiceIds: ['melody', 'gone'], knownVoiceIds: ['melody', 'bass', 'gone'], chords: false },
    playback: { selectedVoiceIds: [], knownVoiceIds: ['melody', 'bass', 'gone'], chords: false },
    notation: { instrumentKey: 'Bb', voices: { melody: { octaveShift: 1 }, gone: { instrumentKey: 'C' } } },
    transposition: { semitones: 2 }
  };
  const defaults = resolvePreferences({ version: 1, defaults: { display: { hideVoicesMatching: '*bass*' }, playback: { hideVoicesMatching: '*counter*' } } }, 'fixture.abc');
  const inventory = [...voices, { id: 'new', name: 'Counterpoint' }, { id: 'newbass' }];
  const refreshed = refreshFileVoices(choices, defaults, inventory);
  assert.deepEqual(refreshed.display.selectedVoiceIds, ['melody', 'new']);
  assert.deepEqual(refreshed.playback.selectedVoiceIds, ['newbass']);
  assert.deepEqual(refreshed.display.knownVoiceIds, inventory.map(voice => voice.id));
  assert.equal(refreshed.playback.chords, false);
  assert.deepEqual(refreshed.notation, { instrumentKey: 'Bb', voices: { melody: { octaveShift: 1 } } });
  assert.deepEqual(refreshed.transposition, { semitones: 2 });
  assert.deepEqual(refreshFileVoices(refreshed, defaults, inventory), refreshed);
  assert.ok(choices.notation.voices.gone);
});
test('new preference fields validate and round trip', () => {
  const value = { version: 1, defaults: { display: { hideVoicesMatching: '*bass*', chords: false } }, files: { 'fixture.abc': { playback: { selectedVoiceIds: [], knownVoiceIds: ['melody'] } } } };
  assert.deepEqual(parsePreferences(serializePreferences(value)), value);
  for (const display of [{ hideVoicesMatching: 12 }, { selectedVoiceIds: 'melody' }, { knownVoiceIds: [3] }]) {
    assert.throws(() => validateChoices({ display }));
  }
});
test('array filters combine exact case-sensitive IDs and case-insensitive regex with OR', () => {
  for (const [filter, expected] of [
    [{}, ['melody', 'bass']],
    [{ voiceIdFilter: [] }, ['melody', 'bass']],
    [{ voiceIdFilter: ['melody', 'missing'] }, ['melody']],
    [{ voiceIdFilter: ['missing'] }, ['melody', 'bass']],
    [{ voiceIdRegexFilter: ['^BASS$'] }, ['bass']],
    [{ voiceIdFilter: ['BASS'] }, ['melody', 'bass']],
    [{ voiceIdFilter: ['melody'], voiceIdRegexFilter: ['bass', 'melody'] }, ['melody', 'bass']]
  ]) assert.deepEqual(resolveVoiceFilter(filter, voices).ids, expected);
});
test('fallback is diagnostic, immutable and does not hide an empty inventory', () => {
  const filter = { voiceIdFilter: ['missing'] };
  const before = JSON.stringify(filter);
  assert.ok(resolveVoiceFilter(filter, voices).notices.length);
  assert.equal(JSON.stringify(filter), before);
  assert.deepEqual(resolveVoiceFilter(filter, []).ids, []);
});
test('partial overrides merge nested voice properties but replace arrays', () => {
  const preferences = {
    version: 1,
    defaults: { display: { voiceIdFilter: ['melody'], voiceIdRegexFilter: ['bass'] }, notation: { instrumentKey: 'Bb', voices: { bass: { instrumentKey: 'C', octaveShift: -1 } } } },
    files: { 'folder/tune.raw.abc': { display: { voiceIdFilter: [] }, notation: { voices: { bass: { octaveShift: 0 } } }, transposition: { semitones: 2 } } }
  };
  const choices = resolvePreferences(preferences, 'folder/tune.raw.abc');
  assert.deepEqual(choices.display, { voiceIdFilter: [], voiceIdRegexFilter: ['bass'] });
  assert.deepEqual(voiceNotation(choices.notation, 'bass'), { instrumentKey: 'C', octaveShift: 0 });
  assert.equal(voiceNotation(choices.notation, 'melody').instrumentKey, 'Bb');
  assert.equal(choices.transposition.semitones, 2);
  assert.equal(resolvePreferences(preferences, 'another.abc').transposition.semitones, 0);
  delete preferences.files['folder/tune.raw.abc'];
  assert.deepEqual(resolvePreferences(preferences, 'folder/tune.raw.abc').display.voiceIdFilter, ['melody']);
});
test('UTF-8 JSON round trips and has no device-specific paths', () => {
  const value = { version: 1, files: { 'Jacob/Canção.raw.abc': { playback: { chords: false } } } };
  assert.deepEqual(parsePreferences(serializePreferences(value)), value);
});
test('reject invalid versions, unknown fields, unsafe paths and malformed regex', () => {
  for (const value of [
    { version: 2 }, { version: 1, unknown: true }, { version: 1, defaults: { transposition: { semitones: 2 } } },
    { version: 1, files: { '../escape.abc': {} } }, { version: 1, files: { '/absolute.abc': {} } },
    { version: 1, defaults: { display: { voiceIdFilter: 'all' } } },
    { version: 1, defaults: { display: { voiceIdRegexFilter: ['['] } } },
    { version: 1, defaults: { notation: { instrumentKey: 'unknown' } } }
  ]) assert.throws(() => parsePreferences(JSON.stringify(value)));
  assert.throws(() => validateChoices({ transposition: { semitones: 0.5 } }));
});
test('pure configuration assembly retains override order and CRLF', () => {
  const result = assembleAbcText('%%pagescale 1\r\nX:1\r\nT:Fixture\r\nK:C\r\nC|]\r\n', [
    '%%fit2box * *\r\n%%pagescale 0.8', '%%pagescale 0.9'
  ]);
  assert.equal(result.mergedDirectives, '%%fit2box * *\r\n%%pagescale 1');
  assert.equal(result.body, 'X:1\r\nT:Fixture\r\nK:C\r\nC|]\r\n');
});
test('filesystem API and ordinary export preserve the same pure merge behavior', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'abctools-config-'));
  try {
    const root = path.join(directory, 'source');
    const child = path.join(root, 'collection');
    const output = path.join(directory, 'abc');
    await mkdir(child, { recursive: true });
    const configs = ['%%fit2box * *\n%%pagescale 0.8', '%%pagescale 1'];
    await writeFile(path.join(root, '.base.abcconfig'), configs[0]);
    await writeFile(path.join(child, '.child.abcconfig'), configs[1]);
    const content = 'X:1\nT:Fixture\n%%score melody\nM:2/4\nL:1/4\nK:C\nC D|]\n';
    const raw = path.join(child, 'fixture.raw.abc');
    await writeFile(raw, content);
    const expected = assembleAbcText(content, configs);
    assert.deepEqual(getEffectiveAbcConfig(root, raw), expected);
    await assembleRawAbc(raw, root, output);
    const exported = await readFile(path.join(output, 'collection/fixture.abc'), 'utf8');
    assert.equal(exported.replace(/^% Generated by abctools.*\n/, ''), `${expected.mergedDirectives}\n\n${content}`);
    assert.equal(await readFile(raw, 'utf8'), content);
  } finally { await rm(directory, { recursive: true }); }
});
