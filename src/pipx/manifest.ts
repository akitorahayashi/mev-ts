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

export interface PostInstall {
  readonly bin: string;
  readonly args?: readonly string[];
}

export interface PipxTool {
  readonly package: string;
  readonly version?: string;
  readonly install_spec?: string;
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
  const parsed = loadYaml(raw, path);
  if (!isRecord(parsed)) {
    throw new ProvisioningError(
      `Pipx config must contain a tools sequence: ${path}`,
    );
  }
  requireExactKeys(parsed, ['tools', 'uninstall'], `Pipx config ${path}`);
  const tools = parsed['tools'];
  if (!Array.isArray(tools)) {
    throw new ProvisioningError(
      `Pipx config must contain a tools sequence: ${path}`,
    );
  }
  const parsedTools = tools.map((entry) => parseTool(entry));
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
    `Pipx config ${path}`,
  );
  return [
    ...uninstall.map(
      (name) => ({ action: 'uninstall', package: name }) as const,
    ),
    ...parsedTools.map((tool) => ({ action: 'install', tool }) as const),
  ];
}

function parseTool(entry: unknown): PipxTool {
  if (!isRecord(entry)) {
    throw new ProvisioningError(
      'Invalid entry in pipx config: each tool must be a mapping.',
    );
  }
  requireExactKeys(
    entry,
    ['package', 'version', 'install_spec', 'inject', 'post_install'],
    'Invalid entry in pipx config',
  );
  if (
    typeof entry['package'] !== 'string' ||
    !SAFE_PACKAGE_NAME.test(entry['package'])
  ) {
    throw new ProvisioningError(
      "Invalid entry in pipx config: each tool must have a package name of letters, digits, and ._- that does not start with '-' or '.'.",
    );
  }
  const pkg = entry['package'];
  if (
    entry['version'] !== undefined &&
    (typeof entry['version'] !== 'string' || entry['version'].length === 0)
  ) {
    throw new ProvisioningError(
      `Invalid entry in pipx config for '${pkg}': 'version' must be a non-empty string.`,
    );
  }
  if (
    entry['install_spec'] !== undefined &&
    (typeof entry['install_spec'] !== 'string' ||
      entry['install_spec'].length === 0)
  ) {
    throw new ProvisioningError(
      `Invalid entry in pipx config for '${pkg}': 'install_spec' must be a non-empty string.`,
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
  return {
    package: pkg,
    version: entry['version'],
    install_spec: entry['install_spec'],
    inject,
    post_install,
  };
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
