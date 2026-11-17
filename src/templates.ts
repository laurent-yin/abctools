export type TemplateDefinition = {
  name: string;
  lines: string[];
  source: string;
  line: number;
};

export type TemplateLine = { raw: string; line: number; template?: TemplateDefinition };

const namePattern = /^[\p{L}\p{N}_.-]+(?: +[\p{L}\p{N}_.-]+)*$/u;
const standaloneCall = /^(\s*)\{\{([^{}]*)\}\}(\s*(?:%.*)?)$/;
const inlineFields = new Set(['I', 'K', 'L', 'M', 'P', 'Q', 'U', 'V', 'r']);
const structuralCommands = new Set([
  'abc-charset', 'abc-creator', 'abc-include', 'abc-version', 'abcm2ps',
  'decoration', 'linebreak', 'select', 'ss-pref', 'tune', 'voice',
]);

function fail(source: string, line: number, message: string): never {
  throw new Error(`${source}:${line}: ${message}`);
}

function templateName(value: string, source: string, line: number): string {
  const name = value.trim();
  if (!namePattern.test(name)) {
    fail(source, line, `Invalid template name "${name}". Use letters, numbers, spaces, ".", "_" or "-".`);
  }
  return name;
}

function blockCommand(line: string): string | undefined {
  return line.trim().match(/^(?:%%|I:)\s*begin(\S*)\b/)?.[1];
}

function endsBlock(line: string, block: string): boolean {
  return line.trim() === `%%end${block}` || line.trim() === `I:end${block}`;
}

/** Keep template blocks atomic so configuration merging cannot split their contents. */
export function parseTemplateLines(content: string, source: string, tuneSource = false): TemplateLine[] {
  const lines = content.split(/\r?\n/);
  const result: TemplateLine[] = [];
  const names = new Set<string>();
  let block: string | undefined;
  let musicStarted = false;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (block !== undefined) {
      result.push({ raw, line: i + 1 });
      if (endsBlock(raw, block)) block = undefined;
      continue;
    }
    block = blockCommand(raw);
    if (block !== undefined) {
      result.push({ raw, line: i + 1 });
      continue;
    }
    if (/^\s*K:/.test(raw)) musicStarted = true;
    const start = raw.trim().match(/^%%template(?:\s+(.*))?$/);
    if (!start) {
      if (/^\s*%%endtemplate\b/.test(raw)) fail(source, i + 1, 'Unexpected %%endtemplate.');
      result.push({ raw, line: i + 1 });
      continue;
    }
    if (tuneSource && musicStarted) {
      fail(source, i + 1, 'Define templates before the first K: field.');
    }
    const name = templateName(start[1] ?? '', source, i + 1);
    if (names.has(name)) fail(source, i + 1, `Template "${name}" is defined twice in this file.`);
    names.add(name);
    const line = i + 1;
    const body: string[] = [];
    while (++i < lines.length && lines[i].trim() !== '%%endtemplate') {
      if (/^\s*%%template\b/.test(lines[i])) fail(source, i + 1, 'Template definitions cannot be nested.');
      if (lines[i].includes('{{')) fail(source, i + 1, 'Templates cannot call other templates.');
      body.push(lines[i]);
    }
    if (i === lines.length) fail(source, line, `Template "${name}" is missing %%endtemplate.`);
    result.push({
      raw: [`%%template ${name}`, ...body, '%%endtemplate'].join('\n'),
      line,
      template: { name, lines: body, source, line },
    });
  }
  return result;
}

function withoutComment(line: string): string {
  line = line.trim();
  let quoted = false;
  for (let i = line.startsWith('%%') ? 2 : 0; i < line.length; i++) {
    if (line[i] === '\\') {
      i++;
    } else if (line[i] === '"') {
      quoted = !quoted;
    } else if (line[i] === '%' && !quoted) {
      return line.slice(0, i).trim();
    }
  }
  return line.trim();
}

function inlineTemplate(definition: TemplateDefinition, source: string, line: number): string {
  const incompatible = (text: string): never => fail(source, line,
    `Template "${definition.name}" contains "${text}", which cannot be inserted inline. Put its call on a dedicated line.`);
  return definition.lines.flatMap(raw => {
    const text = withoutComment(raw);
    if (!text) return [];
    if (text.startsWith('[')) {
      const fields = text.match(/\[[A-Za-z]:[^[\]]*\]/g);
      if (!fields || fields.join('').replace(/\s/g, '') !== text.replace(/\s/g, '')) {
        return incompatible(text);
      }
      return fields.map(field => {
        const expanded = inlineTemplate({ ...definition, lines: [field.slice(1, -1)] }, source, line);
        return expanded;
      });
    }
    let instruction: string;
    if (text.startsWith('%%')) {
      instruction = text.slice(2).trim();
    } else if (text.startsWith('I:')) {
      instruction = text.slice(2).trim();
    } else {
      const field = text.match(/^([A-Za-z]):(.*)$/);
      if (!field || !inlineFields.has(field[1])) return incompatible(text);
      if (field[1] !== 'I') {
        if (field[2].includes(']')) return incompatible(text);
        return [`[${field[1]}:${field[2]}]`];
      }
      instruction = field[2].trim();
    }
    const command = instruction.match(/^\S+/)?.[0];
    if (!command || structuralCommands.has(command) || /^(?:begin|end)/.test(command)) {
      return incompatible(text);
    }
    // A closing bracket would terminate the inline field before the directive ends.
    if (/[\[\]]/.test(instruction)) return incompatible(text);
    return [`[I:${instruction}]`];
  }).join(' ');
}

/** Expand only standalone calls and calls in music, never text or existing fields. */
export function expandTemplates(
  content: string,
  templates: ReadonlyMap<string, TemplateDefinition>,
  source: string,
  lineNumbers?: readonly number[],
): string {
  const eol = content.match(/\r\n|\n/)?.[0] ?? '\n';
  let block: string | undefined;
  const lookup = (value: string, line: number): TemplateDefinition => {
    const name = templateName(value, source, line);
    const definition = templates.get(name);
    if (!definition) fail(source, line, `Unknown template "${name}".`);
    return definition;
  };
  return content.split(/\r?\n/).map((raw, index) => {
    const line = lineNumbers?.[index] ?? index + 1;
    if (block !== undefined) {
      if (endsBlock(raw, block)) block = undefined;
      return raw;
    }
    block = blockCommand(raw);
    if (block !== undefined) return raw;
    const standalone = raw.match(standaloneCall);
    if (standalone) {
      const definition = lookup(standalone[2], line);
      return definition.lines.map(value => standalone[1] + value).join(eol) + standalone[3];
    }
    if (/^\s*(?:%|[A-Za-z+]:)/.test(raw)) return raw;
    let output = '';
    let quoted = false;
    let bracketDepth = 0;
    for (let i = 0; i < raw.length; i++) {
      const char = raw[i];
      if (char === '\\' && i + 1 < raw.length) {
        output += raw.slice(i, i + 2);
        i++;
        continue;
      }
      if (char === '"') quoted = !quoted;
      if (!quoted && !bracketDepth && char === '%') return output + raw.slice(i);
      if (!quoted && !bracketDepth && raw.startsWith('{{', i)) {
        const end = raw.indexOf('}}', i + 2);
        if (end < 0) fail(source, line, 'Template call is missing "}}".');
        output += inlineTemplate(lookup(raw.slice(i + 2, end), line), source, line);
        i = end + 1;
        continue;
      }
      if (!quoted && char === '[') bracketDepth++;
      if (!quoted && char === ']' && bracketDepth) bracketDepth--;
      output += char;
    }
    return output;
  }).join(eol);
}
