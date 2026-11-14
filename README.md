# abctools

abctools provides utilities for music repositories using the ABC music notation, including a CLI tool to generate .abc files from .raw.abc and .abcconfig files.

## Installation

```sh
npm install -g abctools
```

## Usage

### Export Command

To export .abc files from a source directory to an output directory:

```sh
abctools export <sourceDir> <outDir>
```

- `<sourceDir>`: Directory containing .raw.abc and .abcconfig files
- `<outDir>`: Directory where generated .abc files will be written

#### How it works
- Typically, each folder in `<sourceDir>` contains one `.abcconfig` file.
- `.abcconfig` files only contain ABC directives (commands prefixed by `%%`, such as `%%pagewidth`) and comments (prefixed by `%`, e.g. `% this is a comment`).
- These directives are applied to all `.raw.abc` files in that folder.
- Directives in a parent folder's, for example `.someParent.abcconfig` can be overridden by directives in `.someChild.abcconfig` files in child folders. This allows for hierarchical configuration.
- The export process maintains the folder structure of `<sourceDir>` and mirrors it in `<outDir>`. All generated `.abc` files will be placed in the corresponding subfolders of `<outDir>`.

#### Inputs
- One or more `.raw.abc` files in `<sourceDir>`
- One or more `.abcconfig` files in `<sourceDir>` (merged if multiple, with child folder directives overriding parent ones)

#### Outputs
- `.abc` files generated in `<outDir>`, preserving the directory structure of `<sourceDir>`

Example:

```sh
abctools export src/abc/ dist/abc/
```

### Help

To see available commands:

```sh
abctools --help
```

## Portable application APIs

The existing Node `getEffectiveAbcConfig(root, file, content?)` API and CLI
continue to assemble shared engraving configuration without personal preferences.

Browser-safe ES module entry points are available:

- `abctools/config-text`: `assembleAbcText(content, parentToChildConfigs)` merges
  supplied configuration text without accessing a filesystem. It returns
  `{ mergedDirectives, body }` with the source line-ending convention.
- `abctools/preferences`: versioned JSON validation/serialization, relative-path
  validation, property-wise resolution and independent voice-filter resolution.
- `abctools/chord-grid`: portable measure/chord/annotation types,
  `prepareGridMeasures(measures, repeatMeasures)` for harmonic continuation and
  whole-measure repetition, and `layoutGridRows(measures, widths, width, layout)`
  for source-line or compact layouts. The client supplies parsed musical events
  and measured text widths; no ABC parser, DOM or rendering engine is required.

```js
import { parsePreferences, resolvePreferences, resolveVoiceFilter } from 'abctools/preferences';

const preferences = parsePreferences(jsonText);
const choices = resolvePreferences(preferences, 'collection/tune.raw.abc');
const display = resolveVoiceFilter(choices.display, [
  { id: 'melody', name: 'Melody' },
  { id: 'bass', name: 'Counterpoint' }
]);
```

`hideVoicesMatching` excludes voice IDs/names using case-insensitive whole-text
wildcards (`*` for any text, `?` for one character). Blank/omitted patterns
include all voices. Multiple patterns are separated by `;` and combine with OR;
whitespace and empty entries are ignored. `selectedVoiceIds` is an explicit selection; an empty array
selects none. `knownVoiceIds` records the last file inventory.
`refreshFileVoices(fileChoices, defaults, voices)` drops stale IDs and per-voice
notation overrides, keeps choices for surviving IDs and applies defaults to
new IDs. Clients persist the refreshed result with their usual revision checks.
Both display and playback support an independent `chords` boolean.

Legacy `voiceIdFilter` uses exact, case-sensitive IDs. `voiceIdRegexFilter` uses
case-insensitive ECMAScript regex patterns. Their matches combine with OR;
empty filters or zero total matches select all available voices. Missing
matches produce notices without changing saved preferences. Omitted properties
inherit; arrays replace. Per-voice notation properties inherit independently.

**Execute untrusted regex matching in a cancellable worker**, not on a UI thread.
The resolver itself is synchronous and platform-neutral; it cannot enforce a
host's execution budget. Validation checks syntax and length, not runtime cost.

Preferences have `version: 1`, optional `defaults` and an optional `files` map.
Instrument notation (`notation.instrumentKey`, plus `octaveShift` and per-voice
`notation.voices`) can be defaulted. Song `transposition.semitones` is per file
only, from -24 to +24. Notation transformation and rendering belong to the
renderer adapter, not this resolver. Unknown fields, malformed regex, unsupported
schema versions and invalid values throw explicit errors.

File choices also support `tempo`, a positive whole-number BPM override with no
configured upper bound, for example `"files": { "tune.abc": { "tempo": 90 } }`.
Omit it to use the original authored tempo; `null`, zero, fractional/non-finite
values and tempo defaults are rejected. `validateTempo(value)` is exported for
client controls. Parsing, serialization, resolution and voice-inventory refresh
all preserve this field. Existing version-1 preferences without tempo keep their
previous behavior, and no default BPM is inserted by the resolver.

The client interprets the override in the initial tune's `Q:` beat unit and
scales later authored tempo changes proportionally. Applying playback speed and
discovering the source tempo remain renderer responsibilities; resolving these
preferences never changes the ABC source or the CLI's ordinary exports.

Chord-grid preferences also use version 1:

```json
{
  "version": 1,
  "defaults": {
    "chordGrid": {
      "layout": "source",
      "repeatMeasures": true,
      "showTextInstructions": false
    }
  },
  "files": {
    "collection/tune.abc": { "chordSourceVoiceId": "melody" }
  }
}
```

`chordGrid` is global-only; omitted fields resolve to source lines and repeated
measures enabled, with text instructions hidden. `showTextInstructions: true`
lets clients include authored text annotations such as `a tempo` and `rall.`;
it never enables note ornaments or fermatas. `layout: "compact"` enables wrapping using client-supplied
widths. `chordSourceVoiceId` is file-only; omission means the client's first
declared voice. Inventory refresh drops a source ID only when it disappears,
not when its voice name changes. The client must report unavailable/chordless
sources and source resets rather than silently substitute a different harmony.

Grid times use the caller's consistent musical unit. Each measure has a
positive `duration`, absolute `start`, relative chord/annotation times, start/end
bar types and optional source/section breaks and source IDs. Preparation copies
its input, carries a previous harmony to time zero when needed, leaves empty
opening measures empty, and compares duration plus effective harmonic rhythm.
Consecutive redundant labels do not change that rhythm. `%` never replaces
annotations and is disabled across sections, repeat bars and alternative-ending
starts. N.C. is preserved as an explicit harmony value. Measures marked `pickup`
by the parser adapter are omitted entirely. Their annotations, repeat starts and
layout boundaries move to the next visible measure, while its original timing
is preserved. Authored pickup chords still establish the harmony for following
measures without changing the source or audio.
`formatGridChord` splits conventional labels into root, suffix and optional
slash bass for presentation. It formats accidentals and trailing alterations
(`Bm7b5` becomes `{root: "B", suffix: "m7(♭5)"}`), but does not mutate the musical
model. It returns `undefined` for literal or unrecognized labels such as `N.C.`;
clients display those unchanged. Extension slashes such as `C6/9` are not basses.
Layout returns arrays of measure indices; source layout retains authored groups,
compact layout packs widths, and both respect section boundaries. Oversized
measures get their own compact row rather than being clipped or shrunk.

These entry points import no Node, DOM, database or VS Code APIs. Filesystem,
database, permissions, concurrency and synchronization belong to client adapters.

Run `npm test` for core regression tests.

## Example Repository

See [choro-abc](https://github.com/laurent-yin/choro-abc) for a real-world example of a repository that uses abctools to manage and export ABC music notation files.

## License

MIT