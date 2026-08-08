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

// A package name flows into `join(venvs, package, 'bin', ...)` which is then
// spawned, so it is charset-guarded like brew tokens (SAFE_TOKEN_NAME) and
// github release fields: only letters, digits, and ._- and never a leading '-'
// or '.', so a `..`- or `/`-bearing name cannot traverse out of the venv root.
// The manifest is repo-owned, so this is defense-in-depth.
const SAFE_PACKAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]*$/;

/**
 * The latest-assumed version vocabulary. pipx has no `latest` of its own the
 * way npm has the dist-tag, so this is mev's reserved literal and never reaches
 * an install spec.
 */
export const latestVersion = 'latest';

// PEP 440's normalized form. A pin is compared literally against the version
// pipx reports, which pip has normalized, so a range (`>=1.2`, `~=1.2`), a
// wildcard, or an unnormalized spelling (`1.0.0-rc1`, `01.2`) could never match
// and would uninstall and reinstall the tool on every run.
const EXACT_VERSION =
  /^(?:0|[1-9]\d*)(?:\.(?:0|[1-9]\d*))*(?:(?:a|b|rc)\d+)?(?:\.post\d+)?(?:\.dev\d+)?$/;

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

// A bare scalar is shorthand for `{ version: <scalar> }`, covering the common
// case of a tool with no inject or post_install; the object form is needed
// only when those fields are declared.
function parseTool(pkg: string, value: unknown): PipxTool {
  if (!SAFE_PACKAGE_NAME.test(pkg)) {
    throw new ProvisioningError(
      `Invalid pipx config tool name '${pkg}': must contain only letters, digits, and ._- and not start with '-' or '.'.`,
    );
  }
  const entry = typeof value === 'string' ? { version: value } : value;
  if (!isRecord(entry)) {
    throw new ProvisioningError(
      `Invalid entry in pipx config for '${pkg}': must be a version or a mapping with 'version'.`,
    );
  }
  requireExactKeys(
    entry,
    ['version', 'inject', 'post_install'],
    `Invalid entry in pipx config for '${pkg}'`,
  );
  const version = entry['version'];
  if (typeof version !== 'string') {
    throw new ProvisioningError(
      `Invalid entry in pipx config for '${pkg}': 'version' must be '${latestVersion}' or an exact version pin.`,
    );
  }
  if (version !== latestVersion && !EXACT_VERSION.test(version)) {
    throw new ProvisioningError(
      `Invalid entry in pipx config for '${pkg}': 'version' must be '${latestVersion}' or an exact version pin, not '${version}'.`,
    );
  }
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
