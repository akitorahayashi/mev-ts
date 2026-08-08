import { ProvisioningError } from '../errors';
import {
  isRecord,
  requireExactKeys,
  requireStringArray,
  requireUniqueBy,
} from '../host/parse';
import { loadYaml } from '../host/yaml';

export interface PnpmPackage {
  readonly name: string;
  /** The literal `latest` (latest-assumed) or an exact version pin. */
  readonly version: string;
}

/** A declared package to reconcile, or a name explicitly listed for removal. */
export type PnpmEntry =
  | { readonly action: 'install'; readonly package: PnpmPackage }
  | { readonly action: 'uninstall'; readonly name: string };

// npm registry names are case-insensitively unique, so identity dedup lowers.
export function packageKey(name: string): string {
  return name.toLowerCase();
}

// A pin is compared literally against the installed version, so a range
// (`^1.2`, `1.x`, `>=2`) could never match and would reinstall on every run;
// only `latest` and exact versions are admitted.
const EXACT_VERSION = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

function requirePackageName(name: unknown, label: string): string {
  if (typeof name !== 'string' || name.length === 0 || name.startsWith('-')) {
    throw new ProvisioningError(
      `${label} contains an invalid package name '${String(name)}'.`,
    );
  }
  return name;
}

export function parseManifest(raw: string, path: string): PnpmEntry[] {
  const label = `pnpm global packages manifest ${path}`;
  const parsed = loadYaml(raw, path);
  if (!isRecord(parsed)) {
    throw new ProvisioningError(`${label} must be a mapping.`);
  }
  requireExactKeys(parsed, ['packages', 'uninstall'], label);
  const packagesValue = parsed['packages'];
  if (!isRecord(packagesValue)) {
    throw new ProvisioningError(
      `${label} packages must be a mapping of package names to versions.`,
    );
  }
  const packages = Object.entries(packagesValue).map(([name, version]) => {
    requirePackageName(name, `${label} packages`);
    if (typeof version !== 'string' || version.length === 0) {
      throw new ProvisioningError(
        `${label} packages.${name} must be a non-empty string version.`,
      );
    }
    if (version !== 'latest' && !EXACT_VERSION.test(version)) {
      throw new ProvisioningError(
        `${label} packages.${name} must be 'latest' or an exact version pin, not the range '${version}'.`,
      );
    }
    return { name, version };
  });
  // Absent means nothing to remove; only names written here are ever
  // uninstalled.
  const uninstall =
    parsed['uninstall'] === undefined
      ? []
      : requireStringArray(parsed['uninstall'], `${label} uninstall`).map(
          (name) => requirePackageName(name, `${label} uninstall`),
        );
  requireUniqueBy(
    [...packages.map(({ name }) => name), ...uninstall],
    packageKey,
    label,
  );
  return [
    ...uninstall.map((name) => ({ action: 'uninstall', name }) as const),
    ...packages.map((pkg) => ({ action: 'install', package: pkg }) as const),
  ];
}
