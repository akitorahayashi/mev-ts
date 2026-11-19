import { ProvisioningError } from '../errors';
import {
  requireExactKeys,
  requireRecord,
  requireStringArray,
  requireUniqueBy,
} from '../host/parse';
import { loadYaml } from '../host/yaml';
import type { PackageRequirement, PackageSet } from './package';

export const manifestName = 'brew.yml';

// Names are passed to brew as argv, so a leading dash would be read as an
// option. A tap-qualified name is the only form that may carry slashes.
const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._@+-]*$/;

function requireName(name: string, label: string): string {
  const segments = name.split('/');
  if (
    (segments.length !== 1 && segments.length !== 3) ||
    !segments.every((segment) => SEGMENT.test(segment))
  ) {
    throw new ProvisioningError(
      `${label} contains the invalid name '${name}'; use a bare name or a tap-qualified owner/tap/name whose segments start with a letter or digit and contain only letters, digits, and ._@+- characters.`,
    );
  }
  return name;
}

function parseList(value: unknown, label: string): string[] {
  if (value === undefined) return [];
  return requireStringArray(value, label).map((name) =>
    requireName(name, label),
  );
}

function parseSet(record: Record<string, unknown>, label: string): PackageSet {
  requireExactKeys(record, ['formulae', 'casks'], label);
  return {
    formulae: parseList(record['formulae'], `${label} formulae`),
    casks: parseList(record['casks'], `${label} casks`),
  };
}

export function parseManifest(raw: string, path: string): PackageRequirement {
  const label = `Homebrew manifest ${path}`;
  const parsed = requireRecord(loadYaml(raw, path), label);
  requireExactKeys(parsed, ['formulae', 'casks', 'uninstall'], label);
  const { uninstall: uninstallValue, ...installValue } = parsed;
  const install = parseSet(installValue, label);
  // Absent means nothing to remove; only names written here are ever
  // uninstalled.
  const uninstall =
    uninstallValue === undefined
      ? { formulae: [], casks: [] }
      : parseSet(
          requireRecord(uninstallValue, `${label} uninstall`),
          `${label} uninstall`,
        );
  requireUniqueBy(
    [...install.formulae, ...uninstall.formulae],
    (name) => name,
    `${label} formulae`,
  );
  requireUniqueBy(
    [...install.casks, ...uninstall.casks],
    (name) => name,
    `${label} casks`,
  );
  return { install, uninstall };
}
