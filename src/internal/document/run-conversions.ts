import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { errorMessage } from '../../errors';
import { DocumentConversionError } from './conversion-error';

interface ConversionPair {
  readonly input: string;
  readonly output: string;
}

/**
 * Drive per-file conversion for `pairs`: announce each, create its output
 * directory, run `convertOne`, and announce success — collecting each failure
 * (warned individually) and, once all pairs are attempted, throwing one
 * summarized DocumentConversionError if any failed. Shared by both document
 * directions so the collect-warn-summarize loop lives in one place.
 */
export async function runConversions<Pair extends ConversionPair>(
  pairs: readonly Pair[],
  write: (message: string) => void,
  warn: (message: string) => void,
  convertOne: (pair: Pair) => Promise<void>,
): Promise<void> {
  const failures: string[] = [];
  for (const pair of pairs) {
    write(`Converting ${pair.input}...\n`);
    try {
      await mkdir(dirname(pair.output), { recursive: true });
      await convertOne(pair);
      write(`Created ${pair.output}\n`);
    } catch (error) {
      const failure = `${pair.input}: ${errorMessage(error)}`;
      failures.push(failure);
      warn(`${failure}\n`);
    }
  }
  if (failures.length > 0) {
    throw new DocumentConversionError(
      `Failed to convert ${failures.length} file(s): ${failures.join('; ')}`,
    );
  }
}
