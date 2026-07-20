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

export function normalizedPackageName(name: string): string {
  return name.toLowerCase().replace(/[-_.]+/g, '-');
}

export function parseTools(raw: string, path: string): PipxTool[] {
  const parsed = loadYaml(raw, path);
  if (!isRecord(parsed)) {
    throw new ProvisioningError(
      `Pipx config must contain a tools sequence: ${path}`,
    );
  }
  requireExactKeys(parsed, ['tools'], `Pipx config ${path}`);
  const tools = parsed.tools;
  if (!Array.isArray(tools)) {
    throw new ProvisioningError(
      `Pipx config must contain a tools sequence: ${path}`,
    );
  }
  const parsedTools = tools.map((entry) => parseTool(entry));
  requireUniqueBy(
    parsedTools,
    (tool) => normalizedPackageName(tool.package),
    `Pipx config ${path}`,
  );
  return parsedTools;
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
    typeof entry.package !== 'string' ||
    entry.package.length === 0 ||
    entry.package.startsWith('-')
  ) {
    throw new ProvisioningError(
      'Invalid entry in pipx config: each tool must have a package name that does not start with a dash.',
    );
  }
  const pkg = entry.package;
  if (
    entry.version !== undefined &&
    (typeof entry.version !== 'string' || entry.version.length === 0)
  ) {
    throw new ProvisioningError(
      `Invalid entry in pipx config for '${pkg}': 'version' must be a non-empty string.`,
    );
  }
  if (
    entry.install_spec !== undefined &&
    (typeof entry.install_spec !== 'string' || entry.install_spec.length === 0)
  ) {
    throw new ProvisioningError(
      `Invalid entry in pipx config for '${pkg}': 'install_spec' must be a non-empty string.`,
    );
  }
  const inject =
    entry.inject === undefined
      ? undefined
      : requireStringArray(
          entry.inject,
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
    entry.post_install === undefined
      ? undefined
      : parsePostInstall(entry.post_install, pkg);
  return {
    package: pkg,
    version: entry.version,
    install_spec: entry.install_spec,
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
    typeof record.bin !== 'string' ||
    record.bin.length === 0 ||
    record.bin !== basename(record.bin) ||
    record.bin === '.' ||
    record.bin === '..'
  ) {
    throw new ProvisioningError(
      `Invalid entry in pipx config for '${pkg}': 'post_install.bin' must be a basename executable.`,
    );
  }
  const args =
    record.args === undefined
      ? undefined
      : requireStringArray(
          record.args,
          `Invalid entry in pipx config for '${pkg}': 'post_install.args'`,
        );
  return { bin: record.bin, args };
}
