import { basename } from 'node:path';
import { ProvisioningError } from '../errors';
import {
  isRecord,
  requireExactKeys,
  requireRecord,
  requireStringArray,
  requireUniqueBy,
} from '../host/parse';
import { loadYaml } from '../host/yaml';
import { LATEST } from '../version-pin';

// A package name flows into `join(venvs, package, 'bin', ...)` which is then
// spawned, so it is charset-guarded like brew tokens (SAFE_TOKEN_NAME) and
// github release fields: only letters, digits, and ._- and never a leading '-'
// or '.', so a `..`- or `/`-bearing name cannot traverse out of the venv root.
// The manifest is repo-owned, so this is defense-in-depth.
const SAFE_PACKAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]*$/;

/** mev's reserved literal: pipx has no `latest` the way npm has the dist-tag. */
export const latestVersion = LATEST;

// PEP 440's normalized public version. A pin is compared literally against the
// version pipx reports, so a spelling pip resolves (`>=1.2`, `1.*`) or
// normalizes away (`1.0.0-rc1`, a leading zero in any numeric component)
// reinstalls the tool on every run.
const NUMBER = String.raw`(?:0|[1-9]\d*)`;
const EXACT_VERSION = new RegExp(
  String.raw`^(?:${NUMBER}!)?${NUMBER}(?:\.${NUMBER})*(?:(?:a|b|rc)${NUMBER})?(?:\.post${NUMBER})?(?:\.dev${NUMBER})?$`,
);

export interface PostInstall {
  readonly bin: string;
  readonly args?: readonly string[];
}

export interface PipxTool {
  readonly package: string;
  /** The literal `latest` (latest-assumed) or an exact version pin. */
  readonly version: string;
  readonly inject?: readonly string[];
  readonly post_install?: PostInstall;
}

/** A declared tool to reconcile, or a name explicitly listed for removal. */
export type PipxEntry =
  | { readonly action: 'install'; readonly tool: PipxTool }
  | { readonly action: 'uninstall'; readonly package: string };

export function normalizedPackageName(name: string): string {
  return name.toLowerCase().replace(/[-_.]+/g, '-');
}

export function parseManifest(raw: string, path: string): PipxEntry[] {
  const label = `Pipx config ${path}`;
  const parsed = loadYaml(raw, path);
  if (!isRecord(parsed)) {
    throw new ProvisioningError(`${label} must be a mapping.`);
  }
  requireExactKeys(parsed, ['tools', 'uninstall'], label);
  const tools = parsed['tools'];
  if (!isRecord(tools)) {
    throw new ProvisioningError(
      `${label} tools must be a mapping of package names to versions.`,
    );
  }
  const parsedTools = Object.entries(tools).map(([name, value]) =>
    parseTool(name, value),
  );
  // Absent means nothing to remove; only names written here are ever
  // uninstalled.
  const uninstall =
    parsed['uninstall'] === undefined
      ? []
      : requireStringArray(
          parsed['uninstall'],
          `Pipx config ${path} uninstall`,
        );
  for (const name of uninstall) {
    if (!SAFE_PACKAGE_NAME.test(name)) {
      throw new ProvisioningError(
        `Pipx config ${path} uninstall contains an invalid package name '${name}'.`,
      );
    }
  }
  requireUniqueBy(
    [...parsedTools.map((tool) => tool.package), ...uninstall],
    normalizedPackageName,
    label,
  );
  return [
    ...uninstall.map(
      (name) => ({ action: 'uninstall', package: name }) as const,
    ),
    ...parsedTools.map((tool) => ({ action: 'install', tool }) as const),
  ];
}

// A bare scalar is shorthand for `{ version: <scalar> }`.
function parseTool(pkg: string, value: unknown): PipxTool {
  if (!SAFE_PACKAGE_NAME.test(pkg)) {
    throw new ProvisioningError(
      `Invalid pipx config tool name '${pkg}': must contain only letters, digits, and ._- and not start with '-' or '.'.`,
    );
  }
  const entry = isRecord(value) ? value : { version: value };
  requireExactKeys(
    entry,
    ['version', 'inject', 'post_install'],
    `Invalid entry in pipx config for '${pkg}'`,
  );
  const version = requireVersion(entry['version'], pkg);
  const inject =
    entry['inject'] === undefined
      ? undefined
      : requireStringArray(
          entry['inject'],
          `Invalid entry in pipx config for '${pkg}': 'inject'`,
        );
  if (inject) {
    if (inject.some((dep) => dep.length === 0 || dep.startsWith('-'))) {
      throw new ProvisioningError(
        `Invalid entry in pipx config for '${pkg}': injected dependencies must be non-empty and not start with a dash.`,
      );
    }
    requireUniqueBy(
      inject,
      normalizedPackageName,
      `Invalid entry in pipx config for '${pkg}': 'inject'`,
    );
  }
  const post_install =
    entry['post_install'] === undefined
      ? undefined
      : parsePostInstall(entry['post_install'], pkg);
  return { package: pkg, version, inject, post_install };
}

/**
 * Unquoted `1.0` and `20250625` are valid PEP 440 versions that YAML types as
 * numbers, and rendering one back as text resolves to a different pin than the
 * author wrote (`1.10` to `1.1`), so quoting is required rather than inferred.
 */
function requireVersion(value: unknown, pkg: string): string {
  const label = `Invalid entry in pipx config for '${pkg}'`;
  if (typeof value === 'number') {
    throw new ProvisioningError(
      `${label}: 'version' ${value} must be quoted so YAML preserves it as written.`,
    );
  }
  if (typeof value !== 'string') {
    throw new ProvisioningError(
      `${label}: 'version' must be '${latestVersion}' or an exact version pin.`,
    );
  }
  if (value !== latestVersion && !EXACT_VERSION.test(value)) {
    throw new ProvisioningError(
      `${label}: 'version' must be '${latestVersion}' or an exact version pin, not '${value}'.`,
    );
  }
  return value;
}

function parsePostInstall(value: unknown, pkg: string): PostInstall {
  const record = requireRecord(
    value,
    `Invalid entry in pipx config for '${pkg}': 'post_install'`,
  );
  requireExactKeys(
    record,
    ['bin', 'args'],
    `Invalid entry in pipx config for '${pkg}': 'post_install'`,
  );
  if (
    typeof record['bin'] !== 'string' ||
    record['bin'].length === 0 ||
    record['bin'] !== basename(record['bin']) ||
    record['bin'] === '.' ||
    record['bin'] === '..'
  ) {
    throw new ProvisioningError(
      `Invalid entry in pipx config for '${pkg}': 'post_install.bin' must be a basename executable.`,
    );
  }
  const args =
    record['args'] === undefined
      ? undefined
      : requireStringArray(
          record['args'],
          `Invalid entry in pipx config for '${pkg}': 'post_install.args'`,
        );
  return { bin: record['bin'], args };
}
