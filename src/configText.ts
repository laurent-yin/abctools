/** Pure configuration assembly for filesystem, database and WebView adapters. */
import { expandTemplates, parseTemplateLines, TemplateDefinition } from './templates.js';

export type ParsedLine = { raw: string; key?: string; template?: TemplateDefinition };

export function parseFlatDirectives(content: string, source = 'configuration'): ParsedLine[] {
  return parseTemplateLines(content, source).map(({ raw, template }) => {
    if (template) return { raw, key: `%%template ${template.name}`, template };
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
    if (!line.key && /^\s*\{\{/.test(line.raw)) {
      additions.push(line);
      continue;
    }
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
  const directives = parseFlatDirectives(lines.slice(0, firstX < 0 ? lines.length : firstX).join(lineEnding));
  return { directives, body: firstX < 0 ? abcText : lines.slice(firstX).join(lineEnding), lineEnding };
}
export function assembleAbcText(content: string, parentToChildConfigs: string[]): { mergedDirectives: string; body: string } {
  let config: ParsedLine[] = [];
  for (const [index, text] of parentToChildConfigs.entries()) {
    config = mergeFlatDirectives(config, parseFlatDirectives(text, `configuration ${index + 1}`));
  }
  return assembleParsedAbcText(content, config);
}

export function assembleParsedAbcText(
  content: string, config: ParsedLine[], source = 'source',
): { mergedDirectives: string; body: string } {
  const lines = parseTemplateLines(content, source, true);
  const templates = new Map<string, TemplateDefinition>();
  for (const line of [...config, ...lines]) {
    if (line.template) templates.set(line.template.name, line.template);
  }
  const sourceLines = lines.filter(line => !line.template);
  const text = sourceLines.map(line => line.raw).join(content.match(/\r\n|\n/)?.[0] ?? '\n');
  const { directives, body, lineEnding } = extractDirectivesAndBody(text);
  const merged = mergeFlatDirectives(config.filter(line => !line.template), directives);
  return {
    mergedDirectives: expandTemplates(stringifyParsedLines(merged, lineEnding), templates, source),
    body: expandTemplates(body, templates, source,
      sourceLines.slice(Math.max(0, sourceLines.findIndex(line => line.raw.trim().startsWith('X:'))))
        .map(line => line.line)),
  };
}
