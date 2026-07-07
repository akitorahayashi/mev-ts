import { errorMessage } from '../errors';
import { formatCommandFailure } from '../host/command';
import type { Context } from '../host/context';
import type { PackageKind, PackageRequirement } from '../provisioning/package';

export type KindInventory =
  | { readonly loaded: true; readonly names: ReadonlySet<string> }
  | { readonly loaded: false; readonly error: string };

export type Inventory = Readonly<Record<PackageKind, KindInventory>>;

// `brew list -1` and `brew tap` are directory listings without Ruby startup,
// so a full inventory costs milliseconds regardless of package count.
const enumerations: Record<PackageKind, readonly string[]> = {
  tap: ['tap'],
  formula: ['list', '--formula', '-1'],
  cask: ['list', '--cask', '-1'],
};

const unprobed: KindInventory = { loaded: true, names: new Set() };

function parseNames(stdout: string): ReadonlySet<string> {
  return new Set(
    stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0),
  );
}

async function enumerate(
  context: Context,
  kind: PackageKind,
): Promise<KindInventory> {
  const args = enumerations[kind];
  try {
    const result = await context.commands.run('brew', args);
    if (result.code !== 0) {
      return {
        loaded: false,
        error: formatCommandFailure(`brew ${args.join(' ')} failed`, result),
      };
    }
    return { loaded: true, names: parseNames(result.stdout) };
  } catch (error) {
    return {
      loaded: false,
      error: errorMessage(error),
    };
  }
}

/**
 * Enumerate installed Homebrew state once per kind the requirement uses, so
 * presence checks become in-memory set lookups. Kinds the requirement does
 * not declare are never probed. An enumeration failure is carried as a
 * per-kind error so the caller fails exactly the tokens that depended on it.
 */
export async function loadInventory(
  req: PackageRequirement,
  context: Context,
): Promise<Inventory> {
  return {
    tap: req.taps.length > 0 ? await enumerate(context, 'tap') : unprobed,
    formula:
      req.formulae.length > 0 ? await enumerate(context, 'formula') : unprobed,
    cask: req.casks.length > 0 ? await enumerate(context, 'cask') : unprobed,
  };
}
