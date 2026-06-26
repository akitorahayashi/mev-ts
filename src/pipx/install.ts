import { join } from 'node:path';
import { ProvisioningError } from '../errors';
import type { CommandOptions } from '../host/command';
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

interface PipxConfig {
  readonly tools: readonly PipxTool[];
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

// --- manifest schema --------------------------------------------------------

export async function parseTools(
  raw: string,
  path: string,
): Promise<PipxTool[]> {
  const { load } = await import('js-yaml');
  const parsed = load(raw) as PipxConfig;
  if (!parsed?.tools || !Array.isArray(parsed.tools)) {
    throw new ProvisioningError(
      `Pipx config must contain a tools sequence: ${path}`,
    );
  }
  return parsed.tools.map((tool: PipxTool) => {
    if (!tool?.package) {
      throw new ProvisioningError(
        `Invalid entry in pipx config: each tool must have a package name.`,
      );
    }
    if (tool.inject && !Array.isArray(tool.inject)) {
      throw new ProvisioningError(
        `Invalid entry in pipx config for '${tool.package}': 'inject' must be a sequence of packages.`,
      );
    }
    if (tool.post_install && !tool.post_install.bin) {
      throw new ProvisioningError(
        `Invalid entry in pipx config for '${tool.package}': 'post_install' must specify a 'bin' executable.`,
      );
    }
    return tool;
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
      `brew --prefix failed: ${result.stderr.trim() || `exit code ${result.code}`}`,
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
      `pipx list --json failed: ${result.stderr.trim() || `exit code ${result.code}`}`,
    );
  }
  const data = JSON.parse(result.stdout) as PipxListJson;
  const map = new Map<string, Installed>();
  for (const venv of Object.values(data.venvs ?? {})) {
    const main = venv.metadata?.main_package;
    if (!main) continue;
    map.set(main.package, {
      packageOrUrl: main.package_or_url,
      version: main.package_version,
      dependencies: Object.keys(main.app_paths_of_dependencies ?? {}),
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
      `pipx environment failed: ${result.stderr.trim() || `exit code ${result.code}`}`,
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
    throw new ProvisioningError(r.stderr.trim() || `uninstall exit ${r.code}`);
  }
}

export async function install(
  context: Context,
  options: CommandOptions,
  spec: string,
): Promise<void> {
  const r = await context.commands.run('pipx', ['install', spec], options);
  if (r.code !== 0) {
    throw new ProvisioningError(r.stderr.trim() || `install exit ${r.code}`);
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
    throw new ProvisioningError(r.stderr.trim() || `inject exit ${r.code}`);
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
      r.stderr.trim() || `post_install exit ${r.code}`,
    );
  }
}
