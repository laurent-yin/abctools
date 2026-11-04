/** Portable personal preferences. This entry point has no platform dependencies. */
export const instrumentKeys = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'] as const;
export type InstrumentKey = typeof instrumentKeys[number];
export interface VoiceFilter {
  hideVoicesMatching?: string;
  selectedVoiceIds?: string[];
  knownVoiceIds?: string[];
  chords?: boolean;
  voiceIdFilter?: string[];
  voiceIdRegexFilter?: string[];
}
export interface VoiceNotation {
  instrumentKey?: InstrumentKey;
  octaveShift?: number;
}
export interface Notation extends VoiceNotation {
  voices?: Record<string, VoiceNotation>;
}
export interface PersonalChoices {
  display?: VoiceFilter;
  playback?: VoiceFilter & { chords?: boolean };
  notation?: Notation;
}
export interface FileChoices extends PersonalChoices {
  transposition?: { semitones?: number };
  tempo?: number;
}
export interface Preferences {
  version: 1;
  defaults?: PersonalChoices;
  files?: Record<string, FileChoices>;
}
export interface EffectiveChoices {
  display: VoiceFilter;
  playback: VoiceFilter;
  notation: Notation;
  transposition: { semitones: number };
  tempo?: number;
}
export interface VoiceDescriptor { id: string; name?: string; shortName?: string }
export interface FilterResult { ids: string[]; notices: string[] }

function object(value: unknown, location: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${location} must be an object`);
  }
  return value as Record<string, unknown>;
}
function fields(value: Record<string, unknown>, allowed: string[], location: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new Error(`Unknown preference: ${location}.${key}`);
  }
}
function integer(value: unknown, min: number, max: number, location: string): void {
  if (!Number.isInteger(value) || typeof value !== 'number' || value < min || value > max) {
    throw new Error(`${location} must be an integer between ${min} and ${max}`);
  }
}
export function validateTempo(value: unknown, location = 'tempo'): asserts value is number | undefined {
  if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value) || value < 1)) {
    throw new Error(`${location} must be a whole number of at least 1 BPM, or blank for the original tempo.`);
  }
}
export function validateResourceKey(key: string): string {
  if (!key || key.includes('\\') || key.startsWith('/') || /^[a-zA-Z]:/.test(key)
    || key.split('/').some(part => !part || part === '.' || part === '..') || /[\u0000-\u001f]/.test(key)) {
    throw new Error(`Invalid library-relative resource path: ${key}`);
  }
  return key;
}
function validateFilter(value: unknown, location: string): void {
  const filter = object(value, location);
  fields(filter, ['voiceIdFilter', 'voiceIdRegexFilter', 'chords', 'hideVoicesMatching', 'selectedVoiceIds', 'knownVoiceIds'], location);
  if (filter.hideVoicesMatching !== undefined && (typeof filter.hideVoicesMatching !== 'string' || filter.hideVoicesMatching.length > 512)) {
    throw new Error(`${location}.hideVoicesMatching must be text (at most 512 characters)`);
  }
  for (const field of ['voiceIdFilter', 'voiceIdRegexFilter', 'selectedVoiceIds', 'knownVoiceIds']) {
    const entries = filter[field];
    if (entries === undefined) continue;
    if (!Array.isArray(entries) || entries.length > 128 || entries.some(entry => typeof entry !== 'string' || !entry || entry.length > 512)) {
      throw new Error(`${location}.${field} must be an array of at most 128 nonempty strings (512 characters each)`);
    }
    if (field === 'voiceIdRegexFilter') for (const pattern of entries) {
      try { new RegExp(pattern, 'i'); }
      catch (error) { throw new Error(`${location}.${field}: ${String(error)}`); }
    }
  }
  if (filter.chords !== undefined && typeof filter.chords !== 'boolean') throw new Error(`${location}.chords must be boolean`);
}
function validateNotation(value: unknown, location: string, perVoice = false): void {
  const notation = object(value, location);
  fields(notation, perVoice ? ['instrumentKey', 'octaveShift'] : ['instrumentKey', 'octaveShift', 'voices'], location);
  if (notation.instrumentKey !== undefined && !instrumentKeys.some(key => key === notation.instrumentKey)) {
    throw new Error(`${location}.instrumentKey must be one of ${instrumentKeys.join(', ')}`);
  }
  if (notation.octaveShift !== undefined) integer(notation.octaveShift, -2, 2, `${location}.octaveShift`);
  if (notation.voices !== undefined) {
    for (const [id, voice] of Object.entries(object(notation.voices, `${location}.voices`))) {
      if (!id || id.length > 512) throw new Error(`${location}.voices has an invalid ID`);
      validateNotation(voice, `${location}.voices.${id}`, true);
    }
  }
}
export function validateChoices(value: unknown, perFile = true, location = 'choices'): FileChoices {
  const choices = object(value, location);
  fields(choices, perFile ? ['display', 'playback', 'notation', 'transposition', 'tempo'] : ['display', 'playback', 'notation'], location);
  if (choices.display !== undefined) validateFilter(choices.display, `${location}.display`);
  if (choices.playback !== undefined) validateFilter(choices.playback, `${location}.playback`);
  if (choices.notation !== undefined) validateNotation(choices.notation, `${location}.notation`);
  if (choices.transposition !== undefined) {
    const shift = object(choices.transposition, `${location}.transposition`);
    fields(shift, ['semitones'], `${location}.transposition`);
    if (shift.semitones !== undefined) integer(shift.semitones, -24, 24, `${location}.transposition.semitones`);
  }
  validateTempo(choices.tempo, `${location}.tempo`);
  return choices as FileChoices;
}
export function validatePreferences(value: unknown): Preferences {
  const preferences = object(value, 'preferences');
  fields(preferences, ['version', 'defaults', 'files'], 'preferences');
  if (preferences.version !== 1) throw new Error('Unsupported preferences version (expected 1)');
  if (preferences.defaults !== undefined) validateChoices(preferences.defaults, false, 'defaults');
  if (preferences.files !== undefined) {
    for (const [key, entry] of Object.entries(object(preferences.files, 'files'))) {
      validateResourceKey(key);
      validateChoices(entry, true, `files.${key}`);
    }
  }
  return {
    version: 1,
    ...(preferences.defaults === undefined ? {} : { defaults: validateChoices(preferences.defaults, false, 'defaults') }),
    ...(preferences.files === undefined ? {} : {
      files: Object.fromEntries(Object.entries(object(preferences.files, 'files')).map(([key, choices]) => [key, validateChoices(choices)]))
    })
  };
}
export function parsePreferences(text: string): Preferences {
  return validatePreferences(JSON.parse(text));
}
export function serializePreferences(preferences: Preferences): string {
  validatePreferences(preferences);
  return `${JSON.stringify(preferences, null, 2)}\n`;
}
export function resolvePreferences(preferences: Preferences, resourceKey: string): EffectiveChoices {
  validatePreferences(preferences);
  validateResourceKey(resourceKey);
  const defaults = preferences.defaults ?? {};
  const override = preferences.files?.[resourceKey] ?? {};
  const notation = { ...defaults.notation, ...override.notation };
  const voices: Record<string, VoiceNotation> = Object.create(null);
  for (const id of new Set([...Object.keys(defaults.notation?.voices ?? {}), ...Object.keys(override.notation?.voices ?? {})])) {
    voices[id] = { ...defaults.notation?.voices?.[id], ...override.notation?.voices?.[id] };
  }
  notation.voices = voices;
  return {
    display: { voiceIdFilter: [], voiceIdRegexFilter: [], ...defaults.display, ...override.display },
    playback: { voiceIdFilter: [], voiceIdRegexFilter: [], ...defaults.playback, ...override.playback },
    notation,
    transposition: { semitones: override.transposition?.semitones ?? 0 },
    ...(override.tempo === undefined ? {} : { tempo: override.tempo })
  };
}
/** Run untrusted regex matching in a cancellable worker, never on a UI thread. */
export function resolveVoiceFilter(filter: VoiceFilter, voices: VoiceDescriptor[]): FilterResult {
  if (filter.selectedVoiceIds !== undefined) {
    return { ids: voices.filter(voice => filter.selectedVoiceIds!.includes(voice.id)).map(voice => voice.id), notices: [] };
  }
  if (filter.hideVoicesMatching !== undefined) {
    const patterns = filter.hideVoicesMatching.split(';').map(pattern => pattern.trim()).filter(Boolean);
    return { ids: voices.filter(voice => !patterns.some(pattern => [voice.id, voice.name, voice.shortName].some(name => name && wildcardMatches(pattern, name)))).map(voice => voice.id), notices: [] };
  }
  const exact = filter.voiceIdFilter ?? [];
  const patterns = filter.voiceIdRegexFilter ?? [];
  const matches = new Set<string>();
  const notices: string[] = [];
  for (const id of exact) {
    if (voices.some(voice => voice.id === id)) matches.add(id);
    else notices.push(`Voice ID "${id}" is not present.`);
  }
  for (const pattern of patterns) {
    const regex = new RegExp(pattern, 'i');
    const selected = voices.filter(voice => regex.test(voice.id));
    for (const voice of selected) matches.add(voice.id);
    if (!selected.length) notices.push(`Voice pattern "${pattern}" has no matches.`);
  }
  if ((exact.length || patterns.length) && !matches.size) notices.push('No voices matched; using all source voices.');
  if (!voices.length) notices.push('No source voices are available.');
  return { ids: voices.filter(voice => !matches.size || matches.has(voice.id)).map(voice => voice.id), notices };
}

/** Wildcards match the whole name; use *bass* for a contained word. No regex evaluation. */
export function wildcardMatches(pattern: string, text: string): boolean {
  const tokens = Array.from(pattern.toLowerCase());
  let previous: boolean[] = Array(tokens.length + 1).fill(false);
  previous[0] = true;
  for (let i = 1; i <= tokens.length; i++) previous[i] = tokens[i - 1] === '*' && previous[i - 1];
  for (const character of text.toLowerCase()) {
    const current: boolean[] = Array(tokens.length + 1).fill(false);
    for (let i = 1; i <= tokens.length; i++) {
      current[i] = tokens[i - 1] === '*' ? current[i - 1] || previous[i]
        : previous[i - 1] && (tokens[i - 1] === '?' || tokens[i - 1] === character);
    }
    previous = current;
  }
  return previous[tokens.length];
}

export function refreshFileVoices(choices: FileChoices, defaults: EffectiveChoices, voices: VoiceDescriptor[]): FileChoices {
  const result = structuredClone(choices);
  const ids = [...new Set(voices.map(voice => voice.id))];
  for (const operation of ['display', 'playback'] as const) {
    const filter = choices[operation];
    if (!filter) continue;
    const selected = resolveVoiceFilter({ ...defaults[operation], ...filter }, voices).ids;
    const known = filter.knownVoiceIds ?? ids;
    const defaultIds = resolveVoiceFilter(defaults[operation], voices).ids;
    result[operation] = {
      selectedVoiceIds: ids.filter(id => known.includes(id) ? selected.includes(id) : defaultIds.includes(id)),
      knownVoiceIds: ids,
      ...(filter.chords === undefined ? {} : { chords: filter.chords })
    };
  }
  if (result.notation?.voices) {
    result.notation.voices = Object.fromEntries(Object.entries(result.notation.voices).filter(([id]) => ids.includes(id)));
  }
  return result;
}
export function voiceNotation(notation: Notation, id: string): VoiceNotation {
  return { instrumentKey: notation.instrumentKey, octaveShift: notation.octaveShift, ...notation.voices?.[id] };
}
