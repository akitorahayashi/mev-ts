import type { Stats } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from 'node:path';
import { errorMessage } from '../../errors';
import { DocumentConversionError } from './conversion-error';

export interface ConversionPair {
  readonly input: string;
  readonly output: string;
}

function hasExtension(path: string, extensions: ReadonlySet<string>): boolean {
  return extensions.has(extname(path).toLowerCase());
}

function isWithin(parent: string, candidate: string): boolean {
  const path = relative(parent, candidate);
  return path === '' || (!path.startsWith(`..${sep}`) && !isAbsolute(path));
}

async function collectFiles(
  directory: string,
  extensions: ReadonlySet<string>,
  excludedDirectory: string,
): Promise<string[]> {
  const files: string[] = [];
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (path === excludedDirectory) continue;
      files.push(...(await collectFiles(path, extensions, excludedDirectory)));
    } else if (entry.isFile() && hasExtension(path, extensions)) {
      files.push(path);
    }
  }
  return files;
}

function outputPath(
  input: string,
  directory: string,
  extension: string,
): string {
  return join(directory, `${basename(input, extname(input))}${extension}`);
}

function macosPathKey(path: string): string {
  return path.normalize('NFC').toLocaleLowerCase('en-US');
}

export async function planConversions(
  inputPath: string,
  outputDirectory: string | undefined,
  inputExtensions: readonly string[],
  outputExtension: string,
): Promise<readonly ConversionPair[]> {
  const input = resolve(inputPath);
  const extensions = new Set(
    inputExtensions.map((value) => value.toLowerCase()),
  );

  let inputStat: Stats;
  try {
    inputStat = await stat(input);
  } catch (error) {
    throw new DocumentConversionError(
      `Unable to read input '${input}': ${errorMessage(error)}`,
    );
  }

  if (inputStat.isFile()) {
    if (!hasExtension(input, extensions)) {
      throw new DocumentConversionError(
        `Unsupported input extension '${extname(input)}'. Expected: ${inputExtensions.join(', ')}.`,
      );
    }
    const directory = outputDirectory
      ? resolve(outputDirectory)
      : dirname(input);
    return [{ input, output: outputPath(input, directory, outputExtension) }];
  }

  if (!inputStat.isDirectory()) {
    throw new DocumentConversionError(
      `Input '${input}' must be a file or directory.`,
    );
  }

  const directory = resolve(outputDirectory ?? 'document_outputs');
  const excludedDirectory =
    directory !== input && isWithin(input, directory) ? directory : '';
  const inputs = await collectFiles(input, extensions, excludedDirectory);
  if (inputs.length === 0) {
    throw new DocumentConversionError(
      `No ${inputExtensions.join('/')} files found under '${input}'.`,
    );
  }

  const outputs = new Map<string, string>();
  const pairs = inputs.map((path) => {
    const relativePath = relative(input, path);
    const output = outputPath(
      path,
      join(directory, dirname(relativePath)),
      outputExtension,
    );
    const key = macosPathKey(output);
    const collision = outputs.get(key);
    if (collision) {
      throw new DocumentConversionError(
        `Inputs '${collision}' and '${path}' both map to '${output}'.`,
      );
    }
    outputs.set(key, path);
    return { input: path, output };
  });
  return pairs;
}
