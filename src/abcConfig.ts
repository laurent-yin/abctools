import * as path from 'path';
import * as fs from 'fs';
import { ParsedLine, parseFlatDirectives, mergeFlatDirectives, stringifyParsedLines, extractDirectivesAndBody } from './configText.js';
export { ParsedLine, parseFlatDirectives, mergeFlatDirectives, stringifyParsedLines, extractDirectivesAndBody } from './configText.js';

// Revised flat-line-based directive merger with comment preservation

function getAbcConfigFilesUpToRoot(rootDir: string, startDir: string): string[] {
  const abcConfFiles: string[] = [];
  let dir = startDir;
  while (true) {
    // Find all *.abcconfig files in this directory, sort alphabetically
    const files = fs.readdirSync(dir)
      .filter(f => f.endsWith('.abcconfig'))
      .map(f => path.join(dir, f))
      .sort();
    abcConfFiles.unshift(...files); // parent first, sorted
    if (rootDir === dir || dir === path.dirname(dir)) break;
    dir = path.dirname(dir);
  }
  return abcConfFiles;
}

/**
 * Finds all .abcconfig.* files from the directory of rawAbcFilePath up to rootDir, merges their directives with those from the ABC file,
 * and returns the merged directives as a string and the rest of the file.
 *
 * @param rootDir The root directory to stop searching for .abcconfig files
 * @param rawAbcFilePath The absolute path to the .abc file
 * @param fileContent Optional: content of the ABC file if already read, otherwise it will be read from the file system
 */
export function getEffectiveAbcConfig(
  rootDir: string,
  rawAbcFilePath: string,
  fileContent?: string | null
): { mergedDirectives: string, body: string } {
  // Use getMergedConfigParsedLines to get merged config up to the file's directory
  const mergedDirectivesLines = getMergedConfigParsedLines(rootDir, path.dirname(rawAbcFilePath));

  // Use provided fileContent if given, otherwise read from file
  const abcText = fileContent != null ? fileContent : fs.readFileSync(rawAbcFilePath, 'utf8');
  const { directives: abcDirectives, body, lineEnding } = extractDirectivesAndBody(abcText);
  const mergedDirectives = mergeFlatDirectives([...mergedDirectivesLines], abcDirectives);

  return { mergedDirectives: stringifyParsedLines(mergedDirectives, lineEnding), body };
}

/**
 * Merges all .abcconfig files from fileDir up to rootDir into a single ParsedLine[]
 */
export function getMergedConfigParsedLines(rootDir: string, fileDir: string): ParsedLine[] {
  const abcConfFiles = getAbcConfigFilesUpToRoot(rootDir, fileDir);
  let mergedDirectives: ParsedLine[] = [];
  for (const file of abcConfFiles) {
    const content = fs.readFileSync(file, 'utf8');
    const parsed = parseFlatDirectives(content);
    mergedDirectives = mergeFlatDirectives(mergedDirectives, parsed);
  }
  return mergedDirectives;
}