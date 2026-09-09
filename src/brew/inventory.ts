import { errorMessage, ProvisioningError } from '../errors';
import { formatCommandFailure } from '../host/command';
import type { Context } from '../host/context';
import { isRecord, parseJsonLabeled } from '../host/parse';
import type {
  PackageKind,
  PackageRequirement,
  UpgradeablePackageKind,
} from './package';

export type KindInventory =
  | { readonly loaded: true; readonly names: ReadonlySet<string> }
  | { readonly loaded: false; readonly error: string };

export type Inventory = Readonly<Record<PackageKind, KindInventory>>;

export type KindVersionInventory =
  | {
      readonly loaded: true;
      readonly versions: ReadonlyMap<string, readonly string[]>;
    }
  | { readonly loaded: false; readonly error: string };

export type VersionInventory = Readonly<
  Record<UpgradeablePackageKind, KindVersionInventory>
>;

// `brew list -1` and `brew tap` are directory listings without Ruby startup,
// so a full inventory costs milliseconds regardless of package count.
const enumerations: Record<PackageKind, readonly string[]> = {
  tap: ['tap'],
  formula: ['list', '--formula', '-1'],
  cask: ['list', '--cask', '-1'],
};

const unprobed: KindInventory = { loaded: true, names: new Set() };
const unprobedVersions: KindVersionInventory = {
  loaded: true,
  versions: new Map(),
};

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
  const [tap, formula, cask] = await Promise.all([
    req.taps.length > 0 ? enumerate(context, 'tap') : unprobed,
    req.formulae.length > 0 ? enumerate(context, 'formula') : unprobed,
    req.casks.length > 0 ? enumerate(context, 'cask') : unprobed,
  ]);
  return { tap, formula, cask };
}

function normalizedVersions(versions: readonly string[]): readonly string[] {
  return [...new Set(versions)].sort((left, right) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
}

function installedVersionMap(
  stdout: string,
  kind: UpgradeablePackageKind,
): ReadonlyMap<string, readonly string[]> {
  const label = `brew info --json=v2 --${kind} output`;
  const data = parseJsonLabeled(stdout, label);
  if (!isRecord(data)) {
    throw new ProvisioningError(`Invalid ${label}: expected an object.`);
  }
  const collectionName = kind === 'formula' ? 'formulae' : 'casks';
  const collection = data[collectionName];
  if (!Array.isArray(collection)) {
    throw new ProvisioningError(
      `Invalid ${label}: ${collectionName} must be an array.`,
    );
  }

  const versions = new Map<string, readonly string[]>();
  for (const [index, entry] of collection.entries()) {
    if (!isRecord(entry)) {
      throw new ProvisioningError(
        `Invalid ${label}: ${collectionName}[${index}] must be an object.`,
      );
    }
    const nameField = kind === 'formula' ? 'name' : 'token';
    const name = entry[nameField];
    if (typeof name !== 'string' || name.trim() === '') {
      throw new ProvisioningError(
        `Invalid ${label}: ${collectionName}[${index}].${nameField} must be a non-empty string.`,
      );
    }
    if (versions.has(name)) {
      throw new ProvisioningError(
        `Invalid ${label}: duplicate ${kind} '${name}'.`,
      );
    }

    const installed = entry['installed'];
    if (kind === 'formula') {
      if (!Array.isArray(installed)) {
        throw new ProvisioningError(
          `Invalid ${label}: installed versions for formula '${name}' must be an array.`,
        );
      }
      const formulaVersions = installed.map((value, installedIndex) => {
        if (!isRecord(value)) {
          throw new ProvisioningError(
            `Invalid ${label}: installed[${installedIndex}] for formula '${name}' must be an object.`,
          );
        }
        const version = value['version'];
        if (typeof version !== 'string' || version.trim() === '') {
          throw new ProvisioningError(
            `Invalid ${label}: installed[${installedIndex}].version for formula '${name}' must be a non-empty string.`,
          );
        }
        return version.trim();
      });
      versions.set(name, normalizedVersions(formulaVersions));
      continue;
    }

    if (installed === null) {
      versions.set(name, []);
      continue;
    }
    if (typeof installed !== 'string' || installed.trim() === '') {
      throw new ProvisioningError(
        `Invalid ${label}: installed version for cask '${name}' must be a non-empty string or null.`,
      );
    }
    versions.set(name, [installed.trim()]);
  }
  return versions;
}

async function enumerateInstalledVersions(
  context: Context,
  kind: UpgradeablePackageKind,
  names: readonly string[],
): Promise<KindVersionInventory> {
  const args = ['info', '--json=v2', `--${kind}`, ...names];
  try {
    const result = await context.commands.run('brew', args);
    if (result.code !== 0) {
      return {
        loaded: false,
        error: formatCommandFailure(`brew ${args.join(' ')} failed`, result),
      };
    }
    return {
      loaded: true,
      versions: installedVersionMap(result.stdout, kind),
    };
  } catch (error) {
    return { loaded: false, error: errorMessage(error) };
  }
}

/**
 * Read Homebrew-owned installed versions for named formulae and casks. Each
 * populated kind is one batch command, and the two independent kinds run
 * concurrently. Empty kinds are not probed.
 */
export async function loadInstalledVersions(
  req: PackageRequirement,
  context: Context,
): Promise<VersionInventory> {
  const [formula, cask] = await Promise.all([
    req.formulae.length > 0
      ? enumerateInstalledVersions(context, 'formula', req.formulae)
      : unprobedVersions,
    req.casks.length > 0
      ? enumerateInstalledVersions(context, 'cask', req.casks)
      : unprobedVersions,
  ]);
  return { formula, cask };
}
