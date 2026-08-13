import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { errorMessage } from '../../errors';
import { mapWithConcurrency } from '../../host/task-pool';
import { DocumentConversionError } from './conversion-error';
import type { ConversionPair } from './input-files';

export interface RunConversionsOptions {
  readonly concurrency?: number;
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
  options: RunConversionsOptions = {},
): Promise<void> {
  const outcomes = await mapWithConcurrency(
    pairs,
    options.concurrency ?? 1,
    async (pair): Promise<string | undefined> => {
      write(`Converting ${pair.input}...\n`);
      try {
        await mkdir(dirname(pair.output), { recursive: true });
        await convertOne(pair);
        write(`Created ${pair.output}\n`);
        return undefined;
      } catch (error) {
        const failure = `${pair.input}: ${errorMessage(error)}`;
        warn(`${failure}\n`);
        return failure;
      }
    },
  );
  const failures = outcomes.filter(
    (outcome): outcome is string => outcome !== undefined,
  );
  if (failures.length > 0) {
    throw new DocumentConversionError(
      `Failed to convert ${failures.length} file(s): ${failures.join('; ')}`,
    );
  }
}
