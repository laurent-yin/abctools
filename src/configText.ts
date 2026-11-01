/** Pure configuration assembly for filesystem, database and WebView adapters. */
export type ParsedLine = { raw: string; key?: string };

export function parseFlatDirectives(content: string): ParsedLine[] {
  return content.split(/\r?\n/).map(raw => {
    const trimmed = raw.trim();
    return trimmed.startsWith('%%') ? { raw, key: trimmed.split(/\s+/, 1)[0] } : { raw };
  });
}
export function mergeFlatDirectives(baseLines: ParsedLine[], overrideLines: ParsedLine[]): ParsedLine[] {
  if (!baseLines.length) return overrideLines;
  const keyToIndex = new Map<string, number>();
  baseLines.forEach((line, index) => { if (line.key) keyToIndex.set(line.key, index); });
  const additions: ParsedLine[] = [];
  for (let i = 0; i < overrideLines.length; i++) {
    const line = overrideLines[i];
    if (!line.key) continue;
    const existing = keyToIndex.get(line.key);
    if (existing !== undefined) {
      baseLines[existing] = line;
    } else {
      const context: ParsedLine[] = [];
      let j = i - 1;
      while (j >= 0 && overrideLines[j].key === undefined && overrideLines[j].raw.trim().startsWith('%')) {
        context.unshift(overrideLines[j--]);
      }
      if (context.length) additions.push({ raw: '' });
      additions.push(...context, line);
    }
  }
  return [...baseLines, ...additions];
}
export function stringifyParsedLines(lines: ParsedLine[], lineEnding = '\n'): string {
  return lines.map(line => line.raw).join(lineEnding);
}
export function extractDirectivesAndBody(abcText: string): { directives: ParsedLine[]; body: string; lineEnding: string } {
  const lineEnding = abcText.match(/\r\n|\n/)?.[0] ?? '\n';
  const lines = abcText.split(/\r?\n/);
  const firstX = lines.findIndex(line => line.trim().startsWith('X:'));
  const directives = lines.slice(0, firstX < 0 ? lines.length : firstX).flatMap(parseFlatDirectives);
  return { directives, body: firstX < 0 ? abcText : lines.slice(firstX).join(lineEnding), lineEnding };
}
export function assembleAbcText(content: string, parentToChildConfigs: string[]): { mergedDirectives: string; body: string } {
  let config: ParsedLine[] = [];
  for (const text of parentToChildConfigs) config = mergeFlatDirectives(config, parseFlatDirectives(text));
  const { directives, body, lineEnding } = extractDirectivesAndBody(content);
  return { mergedDirectives: stringifyParsedLines(mergeFlatDirectives([...config], directives), lineEnding), body };
}
