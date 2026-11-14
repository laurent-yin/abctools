/** Portable, engraving-independent chord grid model. Times use the caller's unit. */
export interface GridChord { time: number; text: string }
export interface GridAnnotation {
  time: number;
  text: string;
  kind: 'part' | 'ending' | 'navigation' | 'text' | 'meter';
}
export interface GridMeasure {
  start: number;
  duration: number;
  chords: GridChord[];
  annotations: GridAnnotation[];
  barStart: string;
  barEnd: string;
  sourceBreak?: boolean;
  sectionBreak?: boolean;
  pickup?: boolean;
  sourceIds?: number[];
}
export interface PreparedGridMeasure extends GridMeasure { repeat: boolean }

export interface GridChordParts { root: string; suffix: string; bass?: string }

/** Split conventional chord labels for display only; other authored text stays literal. */
export function formatGridChord(value: string): GridChordParts | undefined {
  const note = '[A-G](?:[#b\u266f\u266d\u266e]|\\u{1d12a}|\\u{1d12b}){0,2}';
  const match = value.match(new RegExp(`^(${note})(.*?)(?:/(${note}))?$`, 'u'));
  if (!match || !/^(?:maj|min|dim|aug|sus|add|omit|no|alt|[mMo\u00b0\u00f8\u00d8\u0394\u2206+\u2212-]|[0-9#b\u266f\u266d\u266e(),/ ]|\u{1d12a}|\u{1d12b})*$/u.test(match[2])) return undefined;
  const accidentals = (text: string) => text.replace(/#/g, '\u266f').replace(/b/g, '\u266d');
  let suffix = match[2].replace(/b(?=\d)/g, '\u266d').replace(/#(?=\d)/g, '\u266f');
  suffix = suffix.replace(/^((?:m|maj|min|M|dim|aug)?\d+)((?:[\u266d\u266f\u266e]\d+)+)$/, '$1($2)');
  return {
    root: accidentals(match[1]), suffix,
    ...(match[3] ? { bass: accidentals(match[3]) } : {})
  };
}

function normalized(chords: GridChord[]): GridChord[] {
  const result: GridChord[] = [];
  for (const chord of chords) {
    if (chord.text !== result[result.length - 1]?.text) result.push(chord);
  }
  return result;
}

export function prepareGridMeasures(measures: GridMeasure[], repeatMeasures: boolean): PreparedGridMeasure[] {
  let harmony: string | undefined;
  let previous: PreparedGridMeasure | undefined;
  let pickups: PreparedGridMeasure[] = [];
  return measures.flatMap(input => {
    if (!Number.isFinite(input.start) || !Number.isFinite(input.duration) || input.duration <= 0) throw new Error('Grid measure needs a finite start and positive duration.');
    const chords = input.chords.map(chord => ({ ...chord })).sort((a, b) => a.time - b.time);
    for (const chord of chords) {
      if (!Number.isFinite(chord.time) || chord.time < 0 || chord.time >= input.duration || !chord.text) throw new Error('Grid chord must have text and occur inside its measure.');
    }
    if (!input.pickup && (!chords.length || chords[0].time > 0) && harmony !== undefined) chords.unshift({ time: 0, text: harmony });
    const boundary = input.sectionBreak || input.barStart.includes(':') || previous?.barEnd.includes(':')
      || input.annotations.some(annotation => annotation.kind === 'part' || annotation.kind === 'ending');
    const repeat = !!repeatMeasures && !input.pickup && !boundary && !!previous && chords.length > 0
      && previous.duration === input.duration
      && JSON.stringify(normalized(previous.chords)) === JSON.stringify(normalized(chords));
    const measure: PreparedGridMeasure = {
      ...input, chords: input.pickup ? [] : chords, annotations: input.annotations.map(annotation => ({ ...annotation })),
      ...(input.sourceIds ? { sourceIds: [...input.sourceIds] } : {}), repeat
    };
    if (chords.length) harmony = chords[chords.length - 1].text;
    previous = measure;
    if (input.pickup) {
      pickups.push(measure);
      return [];
    }
    if (pickups.length) {
      // Collapse pickups without losing the section's labels, navigation or repeat start.
      const annotations = [
        ...pickups.flatMap(pickup => pickup.annotations.map(annotation => ({ ...annotation, time: 0 }))),
        ...measure.annotations
      ];
      measure.annotations = annotations.filter((annotation, index) => annotations.findIndex(item =>
        item.kind === annotation.kind && item.text === annotation.text && item.time === annotation.time) === index);
      measure.sourceBreak ||= pickups.some(pickup => pickup.sourceBreak);
      measure.sectionBreak ||= pickups.some(pickup => pickup.sectionBreak);
      measure.barStart = pickups.find(pickup => pickup.barStart.includes(':'))?.barStart
        ?? (measure.barStart === '|' ? pickups[0].barStart : measure.barStart);
      pickups = [];
    }
    return [measure];
  });
}

/** Split measure indices into rows. An oversized single measure stays readable. */
export function layoutGridRows(measures: GridMeasure[], widths: number[], availableWidth: number, layout: 'source' | 'compact'): number[][] {
  if (widths.length !== measures.length || widths.some(width => !Number.isFinite(width) || width <= 0)
    || !Number.isFinite(availableWidth) || availableWidth <= 0 || !['source', 'compact'].includes(layout)) {
    throw new Error('Invalid chord grid layout dimensions or mode.');
  }
  const rows: number[][] = [];
  let row: number[] = [];
  let used = 0;
  for (const [index, measure] of measures.entries()) {
    const breakRow = measure.sectionBreak || (layout === 'source' ? measure.sourceBreak : used + widths[index] > availableWidth);
    if (row.length && breakRow) {
      rows.push(row);
      row = [];
      used = 0;
    }
    row.push(index);
    used += widths[index];
  }
  if (row.length) rows.push(row);
  return rows;
}
