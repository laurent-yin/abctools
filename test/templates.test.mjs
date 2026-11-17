import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { assembleAbcText } from '../dist/configText.js';
import { getEffectiveAbcConfig } from '../dist/abcTools.js';
import { build } from '../dist/assemble.js';
import { existsSync, readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const define = (name, body) => `%%template ${name}\n${body}\n%%endtemplate`;
const polca = define('polca', '%%MIDI gchordon\n%%MIDI gchord fzccfzcz');
const tune = music => `X:1\nT:Fixture\nM:2/4\nL:1/8\nK:C\n${music}\n`;

test('inline templates expand multiple directives and fields without adding music lines', () => {
  const source = tune('[V:melody] {{polca}} "G"G2 B2 | {{entrée finale}} A2 G2 |]');
  const result = assembleAbcText(source, [
    polca,
    define('entrée finale', '% A local change\nM:3/4\nK:D\nQ:1/4=100\n%%MIDI program 25 % guitar'),
  ]);
  assert.equal(result.body, tune('[V:melody] [I:MIDI gchordon] [I:MIDI gchord fzccfzcz] "G"G2 B2 | [M:3/4] [K:D] [Q:1/4=100] [I:MIDI program 25] A2 G2 |]'));
  assert.equal(result.body.split('\n').length, source.split('\n').length);
  assert.doesNotMatch(result.mergedDirectives, /template/);
});

test('dedicated calls preserve multiline ABC including blocks, headers and comments', () => {
  const header = define('en-tête', 'T:Template title\n% Keep this comment\nM:2/4\nL:1/8');
  const text = define('texte', '%%begintext\nA short passage\n%%endtext');
  const result = assembleAbcText('X:1\n{{en-tête}}\nK:C\n{{texte}}\nCDEF |]\n', [header, text]);
  assert.equal(result.body, 'X:1\nT:Template title\n% Keep this comment\nM:2/4\nL:1/8\nK:C\n%%begintext\nA short passage\n%%endtext\nCDEF |]\n');
  assert.doesNotMatch(result.body, /\[I:/);
});

test('parent, child and local templates override whole definitions without leaking to other tunes', () => {
  const configs = [polca, define('polca', '%%MIDI gchord fcfc')];
  assert.match(assembleAbcText(tune('{{polca}} CDEF |]'), configs).body, /gchord fcfc/);
  const source = `X:1\n${define('polca', '%%MIDI gchord fzzz')}\nK:C\nC {{polca}} DEF |]\n`;
  assert.match(assembleAbcText(source, configs).body, /\[I:MIDI gchord fzzz\]/);
  assert.doesNotMatch(assembleAbcText(source, configs).body, /template|fcfc|gchordon/);
  assert.match(assembleAbcText(tune('C {{polca}} DEF |]'), configs).body, /fcfc/);
});

test('calls in text, metadata, comments, lyrics and existing inline fields are untouched', () => {
  const source = `X:1
T:{{unknown}}
m: ~g2 = {a}g{f}g
K:C
% {{unknown}}
"^{{unknown}}" C [r:{{unknown}}] D [I:text {{unknown}}] EF |] % {{unknown}}
w: {{unknown}}
W: {{unknown}}
%%begintext
{{unknown}}
%%template not a definition
%%endtext
`;
  assert.equal(assembleAbcText(source, [polca]).body, source);
});

test('prewritten inline fields and escaped or quoted percent characters are preserved', () => {
  const config = define('custom', '[I:MIDI gchordon][M:2/4]\n%%text "100% sûr"\n%%text escaped\\%value');
  const result = assembleAbcText(tune('C {{custom}} DEF |]'), [config]);
  assert.match(result.body, /\[I:MIDI gchordon\] \[M:2\/4\] \[I:text "100% sûr"\] \[I:text escaped\\%value\]/);
});

test('definitions before X, configuration calls and CRLF use source line endings', () => {
  const source = `${define('local', '%%MIDI program 73')}\n{{local}}\n${tune('C {{polca}} DEF |]')}`.replaceAll('\n', '\r\n');
  const result = assembleAbcText(source, [polca, `${define('global', '%%staffscale 1.1')}\n{{global}}`]);
  assert.match(result.mergedDirectives, /%%staffscale 1.1/);
  assert.match(result.mergedDirectives, /%%MIDI program 73/);
  assert.match(result.body, /\[I:MIDI gchordon\] \[I:MIDI gchord fzccfzcz\]/);
  assert.doesNotMatch(result.body + result.mergedDirectives, /(?<!\r)\n/);
});

test('invalid definitions and unresolved calls fail explicitly', () => {
  for (const [source, configs, message] of [
    [tune('C {{missing}} DEF |]'), [], /source:\d+: Unknown template "missing"/],
    [tune('C {{polca DEF |]'), [polca], /missing "}}"/],
    [tune('CDEF |]'), ['%%template polca\n%%MIDI gchordon'], /configuration 1:1:.*missing %%endtemplate/],
    [tune('CDEF |]'), [polca + '\n' + polca], /defined twice/],
    [tune('CDEF |]'), ['%%endtemplate'], /Unexpected/],
    [tune('CDEF |]'), [define('bad/name', '%%MIDI gchordon')], /Invalid template name/],
    [tune('CDEF |]'), [define('outer', define('inner', 'M:2/4'))], /cannot be nested/],
    [tune('CDEF |]'), [define('outer', '{{polca}}')], /cannot call other templates/],
    [tune(`${polca}\nCDEF |]`), [], /before the first K:/],
  ]) assert.throws(() => assembleAbcText(source, configs), message);
  assert.throws(() => assembleAbcText(`${polca}\n${tune('C {{missing}} DEF |]')}`, []),
    /source:10: Unknown template "missing"/);
});

const rendererPath = process.env.ABC2SVG_LIB
  ?? fileURLToPath(new URL('../../vscode-abc-music-editor/lib/', import.meta.url));
test('expanded templates render and generate the requested accompaniment in abc2svg', {
  skip: existsSync(path.join(rendererPath, 'abc2svg-1.js')) ? false : 'Set ABC2SVG_LIB for renderer integration.',
}, () => {
  const source = `X:1
T:Template playback
M:2/4
L:1/8
${define('polca', '%%MIDI gchordon\n%%MIDI gchord fzccfzcz')}
${define('break final', '%%MIDI gchord fzzz')}
K:C
{{polca}} "C"CDEF | {{break final}} GABc | {{polca}} cBAG |]
`;
  const { mergedDirectives, body } = assembleAbcText(source, []);
  const text = `${mergedDirectives}\n${body}`;
  const context = vm.createContext({ console, document: { createElement: () => ({}), head: { appendChild() {} } } });
  const execute = name => vm.runInContext(readFileSync(path.join(rendererPath, name), 'utf8'), context,
    { timeout: 10000, filename: name });
  execute('abc2svg-1.js');
  context.abc2svg.loadjs = (name, success) => { execute(name); success?.(); };
  const errors = [], images = [];
  context.abc2svg.modules.load(text, () => {}, message => errors.push(message));
  const abc = new context.abc2svg.Abc({ errmsg: message => errors.push(message), img_out: svg => images.push(svg) });
  abc.tosvg('fixture.abc', text);
  assert.deepEqual(errors, []);
  const changes = [];
  const model = abc.tunes[0];
  for (let s = model[0]; s; s = s.ts_next) if (s.subtype === 'midigch' && s.rhy) changes.push([s.time, s.rhy]);
  assert.deepEqual(changes, [[0, 'fzccfzcz'], [768, 'fzzz'], [1536, 'fzccfzcz']]);
  assert.ok(images.some(svg => svg.includes('<svg')));
  execute('snd-1.js');
  context.tune = model;
  vm.runInContext('ToAudio().add(tune[0], tune[1], tune[3])', context, { timeout: 10000 });
  const chord = model[1].find(voice => voice.id === '_chord');
  assert.ok(chord);
  const attacks = [];
  for (let s = chord.sym; s; s = s.next) {
    if (s.type === context.abc2svg.C.NOTE && s.time >= 768 && s.time < 1536) {
      attacks.push([s.time, s.dur, s.notes.length]);
    }
  }
  assert.deepEqual(attacks, [[768, 192, 1]]);
});

test('structural commands, non-inline fields, music and bracket-unsafe directives reject inline calls', () => {
  for (const body of [
    '%%begintext\nHello\n%%endtext', '%%abc-include file.abh', '%%voice melody',
    '%%select .*', '%%linebreak $', 'T:Title', 'X:2', 'w:lyrics',
    'm: ~g2 = {a}g{f}g', 'CDEF |', '%%MIDI gchord G,[Hg]',
    '[I:voice melody]', '[T:Title]',
  ]) {
    assert.throws(() => assembleAbcText(tune('C {{custom}} DEF |]'), [define('custom', body)]),
      /Template "custom".*cannot be inserted inline.*dedicated line/);
  }
});

test('filesystem configuration, pure assembly and batch export expand identically', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'abctools-templates-'));
  try {
    const source = path.join(root, 'source');
    const folder = path.join(source, 'polca');
    const output = path.join(root, 'abc');
    await mkdir(folder, { recursive: true });
    const configs = ['%%MIDI gchordon\n' + polca, define('polca', '%%MIDI gchordon\n%%MIDI gchord fzzz')];
    await writeFile(path.join(source, '.base.abcconfig'), configs[0]);
    await writeFile(path.join(folder, '.polca.abcconfig'), configs[1]);
    const content = tune('C {{polca}} DEF |]');
    const file = path.join(folder, 'one.raw.abc');
    await writeFile(file, content);
    await writeFile(path.join(folder, 'two.raw.abc'), tune('G {{polca}} ABc |]'));
    const expected = assembleAbcText(content, configs);
    assert.deepEqual(getEffectiveAbcConfig(source, file), expected);
    await build(source, output);
    assert.equal((await readFile(path.join(output, 'polca/one.abc'), 'utf8'))
      .replace(/^% Generated by abctools.*\n/, ''), `${expected.mergedDirectives}\n\n${expected.body}`);
    assert.match(await readFile(path.join(output, 'polca/two.abc'), 'utf8'), /G \[I:MIDI gchordon\] \[I:MIDI gchord fzzz\] ABc/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
