import { join } from 'node:path';
import { ProvisioningError } from '../errors';
import { type CommandOptions, commandFailureDetail } from '../host/command';
import type { Context } from '../host/context';

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

export interface Installed {
  readonly packageOrUrl: string;
  readonly version: string;
  readonly dependencies: readonly string[];
}

interface PipxListJson {
  readonly venvs?: Record<
    string,
    {
      readonly metadata?: {
        readonly main_package?: {
          readonly package: string;
          readonly package_or_url: string;
          readonly package_version: string;
          readonly app_paths_of_dependencies?: Record<string, unknown>;
        };
      };
    }
  >;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// --- manifest schema --------------------------------------------------------

export async function parseTools(
  raw: string,
  path: string,
): Promise<PipxTool[]> {
  const { load } = await import('js-yaml');
  const parsed = load(raw) as { tools?: unknown };
  if (!parsed?.tools || !Array.isArray(parsed.tools)) {
    throw new ProvisioningError(
      `Pipx config must contain a tools sequence: ${path}`,
    );
  }
  return parsed.tools.map((entry: unknown) => {
    if (!isRecord(entry)) {
      throw new ProvisioningError(
        `Invalid entry in pipx config: each tool must be a mapping.`,
      );
    }
    if (typeof entry.package !== 'string' || entry.package.length === 0) {
      throw new ProvisioningError(
        `Invalid entry in pipx config: each tool must have a package name.`,
      );
    }
    if (entry.version !== undefined && typeof entry.version !== 'string') {
      throw new ProvisioningError(
        `Invalid entry in pipx config for '${entry.package}': 'version' must be a string.`,
      );
    }
    if (
      entry.install_spec !== undefined &&
      typeof entry.install_spec !== 'string'
    ) {
      throw new ProvisioningError(
        `Invalid entry in pipx config for '${entry.package}': 'install_spec' must be a string.`,
      );
    }
    if (
      entry.inject !== undefined &&
      (!Array.isArray(entry.inject) ||
        !entry.inject.every((dep) => typeof dep === 'string'))
    ) {
      throw new ProvisioningError(
        `Invalid entry in pipx config for '${entry.package}': 'inject' must be a sequence of packages.`,
      );
    }
    if (entry.post_install !== undefined) {
      if (!isRecord(entry.post_install)) {
        throw new ProvisioningError(
          `Invalid entry in pipx config for '${entry.package}': 'post_install' must be a mapping.`,
        );
      }
      if (
        typeof entry.post_install.bin !== 'string' ||
        entry.post_install.bin.length === 0
      ) {
        throw new ProvisioningError(
          `Invalid entry in pipx config for '${entry.package}': 'post_install' must specify a 'bin' executable.`,
        );
      }
      if (
        entry.post_install.args !== undefined &&
        (!Array.isArray(entry.post_install.args) ||
          !entry.post_install.args.every((arg) => typeof arg === 'string'))
      ) {
        throw new ProvisioningError(
          `Invalid entry in pipx config for '${entry.package}': 'post_install.args' must be a sequence of strings.`,
        );
      }
    }
    return entry as unknown as PipxTool;
  });
}

// --- pure reconciliation decisions -----------------------------------------

export function needsReinstall(
  tool: PipxTool,
  installed: Installed | undefined,
): boolean {
  if (!installed) return true;
  if (tool.version && tool.version !== installed.version) return true;
  if (tool.install_spec && tool.install_spec !== installed.packageOrUrl)
    return true;
  return false;
}

export function installSpec(tool: PipxTool): string {
  if (tool.install_spec) return tool.install_spec;
  return tool.version ? `${tool.package}==${tool.version}` : tool.package;
}

export function shouldInject(
  tool: PipxTool,
  installed: Installed | undefined,
  justInstalled: boolean,
): boolean {
  if (!tool.inject || tool.inject.length === 0) return false;
  if (justInstalled) return true;
  const have = installed?.dependencies ?? [];
  return tool.inject.some((dep) => !have.includes(dep));
}

export function shouldPostInstall(
  tool: PipxTool,
  justInstalled: boolean,
  justInjected: boolean,
): boolean {
  if (!tool.post_install) return false;
  return justInstalled || justInjected;
}

// --- state probes -----------------------------------------------------------

/**
 * The environment pipx runs under: brew's bin on PATH ahead of the inherited
 * one, so the brew-managed pipx and its python are used. Throws when brew cannot
 * report its prefix.
 */
export async function brewEnv(context: Context): Promise<CommandOptions> {
  const result = await context.commands.run('brew', ['--prefix']);
  if (result.code !== 0) {
    throw new ProvisioningError(
      `brew --prefix failed: ${commandFailureDetail(result, `exit code ${result.code}`)}`,
    );
  }
  const prefix = result.stdout.trim();
  const base = process.env.PATH ?? '';
  return { env: { PATH: [`${prefix}/bin`, base].filter(Boolean).join(':') } };
}

export async function listInstalled(
  context: Context,
  options: CommandOptions,
): Promise<Map<string, Installed>> {
  const result = await context.commands.run(
    'pipx',
    ['list', '--json'],
    options,
  );
  if (result.code !== 0) {
    throw new ProvisioningError(
      `pipx list --json failed: ${commandFailureDetail(result, `exit code ${result.code}`)}`,
    );
  }
  let data: PipxListJson;
  try {
    data = JSON.parse(result.stdout) as PipxListJson;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new ProvisioningError(
      `Failed to parse pipx list --json output as JSON: ${detail}`,
    );
  }
  if (!isRecord(data)) {
    throw new ProvisioningError(
      'Invalid pipx list --json output: expected an object.',
    );
  }
  if (data.venvs !== undefined && !isRecord(data.venvs)) {
    throw new ProvisioningError(
      'Invalid pipx list --json output: venvs must be an object.',
    );
  }
  const map = new Map<string, Installed>();
  for (const [name, venv] of Object.entries(data.venvs ?? {})) {
    if (!isRecord(venv)) continue;
    const metadata = venv.metadata;
    if (metadata !== undefined && !isRecord(metadata)) {
      throw new ProvisioningError(
        `Invalid pipx list --json output: metadata for '${name}' must be an object.`,
      );
    }
    const main = metadata?.main_package;
    if (!main) continue;
    if (!isRecord(main)) {
      throw new ProvisioningError(
        `Invalid pipx list --json output: main_package for '${name}' must be an object.`,
      );
    }
    if (
      typeof main.package !== 'string' ||
      typeof main.package_or_url !== 'string' ||
      typeof main.package_version !== 'string'
    ) {
      throw new ProvisioningError(
        `Invalid pipx list --json output: main_package for '${name}' must contain string package, package_or_url, and package_version.`,
      );
    }
    const deps = main.app_paths_of_dependencies;
    if (deps !== undefined && !isRecord(deps)) {
      throw new ProvisioningError(
        `Invalid pipx list --json output: app_paths_of_dependencies for '${name}' must be an object.`,
      );
    }
    map.set(main.package, {
      packageOrUrl: main.package_or_url,
      version: main.package_version,
      dependencies: Object.keys(deps ?? {}),
    });
  }
  return map;
}

/**
 * The directory pipx stores tool venvs under, queried from pipx itself so the
 * PIPX_HOME/default resolution is owned by pipx rather than re-derived here.
 */
export async function localVenvs(
  context: Context,
  options: CommandOptions,
): Promise<string> {
  const result = await context.commands.run(
    'pipx',
    ['environment', '--value', 'PIPX_LOCAL_VENVS'],
    options,
  );
  if (result.code !== 0) {
    throw new ProvisioningError(
      `pipx environment failed: ${commandFailureDetail(result, `exit code ${result.code}`)}`,
    );
  }
  return result.stdout.trim();
}

// --- operations (throw on failure) ------------------------------------------

export async function uninstall(
  context: Context,
  options: CommandOptions,
  pkg: string,
): Promise<void> {
  const r = await context.commands.run('pipx', ['uninstall', pkg], options);
  if (r.code !== 0) {
    throw new ProvisioningError(
      commandFailureDetail(r, `uninstall exit ${r.code}`),
    );
  }
}

export async function install(
  context: Context,
  options: CommandOptions,
  spec: string,
): Promise<void> {
  const r = await context.commands.run('pipx', ['install', spec], options);
  if (r.code !== 0) {
    throw new ProvisioningError(
      commandFailureDetail(r, `install exit ${r.code}`),
    );
  }
}

export async function inject(
  context: Context,
  options: CommandOptions,
  pkg: string,
  deps: readonly string[],
): Promise<void> {
  const r = await context.commands.run(
    'pipx',
    ['inject', pkg, ...deps],
    options,
  );
  if (r.code !== 0) {
    throw new ProvisioningError(
      commandFailureDetail(r, `inject exit ${r.code}`),
    );
  }
}

export async function postInstall(
  context: Context,
  options: CommandOptions,
  venvs: string,
  pkg: string,
  post: PostInstall,
): Promise<void> {
  const bin = join(venvs, pkg, 'bin', post.bin);
  const r = await context.commands.run(bin, post.args ?? [], options);
  if (r.code !== 0) {
    throw new ProvisioningError(
      commandFailureDetail(r, `post_install exit ${r.code}`),
    );
  }
}
