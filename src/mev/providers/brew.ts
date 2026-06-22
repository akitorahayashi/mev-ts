import { rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProvisioningError } from '../errors';
import type {
  ApplyResult,
  Context,
  Resource,
  ResourceState,
} from '../resources/model';

let brewfileCounter = 0;

/**
 * Writes a single-entry Brewfile to a temporary path and passes it to the
 * given action. Homebrew Bundle treats already-installed entries as no-ops, so
 * `check` reports desired state and `install` is idempotent.
 */
async function withBrewfile<T>(
  line: string,
  action: (file: string) => Promise<T>,
): Promise<T> {
  brewfileCounter += 1;
  const file = join(tmpdir(), `mev-brewfile-${process.pid}-${brewfileCounter}`);
  await writeFile(file, `${line}\n`);
  try {
    return await action(file);
  } finally {
    await rm(file, { force: true });
  }
}

function formula(name: string): Resource {
  const line = `brew "${name}"`;
  return {
    id: `brew:formula:${name}`,
    dependencies: [],
    concurrencyGroup: 'homebrew',
    inspect(context: Context): Promise<ResourceState> {
      return withBrewfile(line, async (file) => {
        const result = await context.commands.run('brew', [
          'bundle',
          'check',
          `--file=${file}`,
        ]);
        return result.code === 0
          ? { kind: 'present' }
          : { kind: 'missing', detail: name };
      });
    },
    apply(context: Context): Promise<ApplyResult> {
      return withBrewfile(line, async (file) => {
        const result = await context.commands.run('brew', [
          'bundle',
          'install',
          '--no-upgrade',
          `--file=${file}`,
        ]);
        if (result.code !== 0) {
          throw new ProvisioningError(
            `brew bundle install failed for ${name}: ${result.stderr || result.stdout}`,
          );
        }
        return { detail: name };
      });
    },
  };
}

export const brew = {
  formula,
};
