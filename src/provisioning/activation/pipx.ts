import { readFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { deployedPath } from '../../assets/ref';
import { ProvisioningError } from '../../errors';
import type { CommandOptions } from '../../host/command';
import type { Context } from '../../host/context';
import {
  type Activation,
  type ActivationReport,
  type Described,
  errorMessage,
  type StepReport,
} from './contract';

type PipxActivation = Extract<Activation, { kind: 'pipx' }>;

export function applyPipx(configKey: string): Activation {
  return { kind: 'pipx', configKey };
}

export function describePipx(activation: PipxActivation): Described {
  return {
    verb: 'apply',
    source: basename(activation.configKey, extname(activation.configKey)),
    dest: 'python tools',
  };
}

interface PostInstall {
  readonly bin: string;
  readonly args?: readonly string[];
}

interface PipxTool {
  readonly package: string;
  readonly version?: string;
  readonly install_spec?: string;
  readonly inject?: readonly string[];
  readonly post_install?: PostInstall;
}

interface PipxConfig {
  readonly tools: readonly PipxTool[];
}

interface Installed {
  readonly packageOrUrl: string;
  readonly version: string;
  readonly dependencies: readonly string[];
}

// --- pure reconciliation decisions -----------------------------------------

function needsReinstall(
  tool: PipxTool,
  installed: Installed | undefined,
): boolean {
  if (!installed) return true;
  if (tool.version && tool.version !== installed.version) return true;
  if (tool.install_spec && tool.install_spec !== installed.packageOrUrl)
    return true;
  return false;
}

function installSpec(tool: PipxTool): string {
  if (tool.install_spec) return tool.install_spec;
  return tool.version ? `${tool.package}==${tool.version}` : tool.package;
}

function shouldInject(
  tool: PipxTool,
  installed: Installed | undefined,
  justInstalled: boolean,
): boolean {
  if (!tool.inject || tool.inject.length === 0) return false;
  if (justInstalled) return true;
  const have = installed?.dependencies ?? [];
  return tool.inject.some((dep) => !have.includes(dep));
}

function shouldPostInstall(
  tool: PipxTool,
  justInstalled: boolean,
  justInjected: boolean,
): boolean {
  if (!tool.post_install) return false;
  return justInstalled || justInjected;
}

// --- I/O --------------------------------------------------------------------

async function readPipxTools(
  configKey: string,
  home: string,
): Promise<PipxTool[]> {
  const { load } = await import('js-yaml');
  const path = deployedPath({ key: configKey }, home);
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch {
    throw new ProvisioningError(
      `Pipx config file not found: ${path}. Run without --plan to deploy first.`,
    );
  }
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

async function readInstalled(
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

async function brewEnv(context: Context): Promise<CommandOptions> {
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

/**
 * The directory pipx stores tool venvs under, queried from pipx itself so the
 * PIPX_HOME/default resolution is owned by pipx rather than re-derived here.
 */
async function localVenvs(
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

// --- per-tool reconciliation ------------------------------------------------

interface ToolOutcome {
  readonly report: StepReport;
  readonly failed: boolean;
}

async function reconcileTool(
  tool: PipxTool,
  installed: Installed | undefined,
  context: Context,
  options: CommandOptions,
  venvs: string,
): Promise<ToolOutcome> {
  const actions: string[] = [];
  const fail = (error: string): ToolOutcome => ({
    report: {
      key: tool.package,
      value: actions.join(', '),
      status: 'failed',
      error,
    },
    failed: true,
  });

  const reinstall = needsReinstall(tool, installed);

  if (reinstall && installed) {
    const r = await context.commands.run(
      'pipx',
      ['uninstall', tool.package],
      options,
    );
    if (r.code !== 0)
      return fail(r.stderr.trim() || `uninstall exit ${r.code}`);
    actions.push('uninstalled');
  }

  let justInstalled = false;
  if (reinstall) {
    const r = await context.commands.run(
      'pipx',
      ['install', installSpec(tool)],
      options,
    );
    if (r.code !== 0) return fail(r.stderr.trim() || `install exit ${r.code}`);
    justInstalled = true;
    actions.push('installed');
  }

  let justInjected = false;
  if (shouldInject(tool, installed, justInstalled)) {
    const r = await context.commands.run(
      'pipx',
      ['inject', tool.package, ...(tool.inject ?? [])],
      options,
    );
    if (r.code !== 0) return fail(r.stderr.trim() || `inject exit ${r.code}`);
    justInjected = true;
    actions.push('injected');
  }

  if (
    tool.post_install &&
    shouldPostInstall(tool, justInstalled, justInjected)
  ) {
    const bin = join(venvs, tool.package, 'bin', tool.post_install.bin);
    const r = await context.commands.run(
      bin,
      tool.post_install.args ?? [],
      options,
    );
    if (r.code !== 0)
      return fail(r.stderr.trim() || `post_install exit ${r.code}`);
    actions.push('post-installed');
  }

  const status = actions.length > 0 ? 'changed' : 'unchanged';
  return {
    report: {
      key: tool.package,
      value: actions.length > 0 ? actions.join(', ') : 'up to date',
      status,
    },
    failed: false,
  };
}

export async function runPipx(
  activation: PipxActivation,
  context: Context,
  plan: boolean,
): Promise<ActivationReport> {
  const base = describePipx(activation);
  try {
    const tools = await readPipxTools(activation.configKey, context.home);
    if (plan) {
      return { ...base, status: 'changed' };
    }
    const options = await brewEnv(context);
    const installed = await readInstalled(context, options);
    const venvs = tools.some((tool) => tool.post_install)
      ? await localVenvs(context, options)
      : '';

    const reports: StepReport[] = [];
    let failed = false;
    let changed = false;
    for (const tool of tools) {
      const outcome = await reconcileTool(
        tool,
        installed.get(tool.package),
        context,
        options,
        venvs,
      );
      reports.push(outcome.report);
      if (outcome.failed) failed = true;
      else if (outcome.report.status === 'changed') changed = true;
    }

    const status = failed ? 'failed' : changed ? 'changed' : 'unchanged';
    return { ...base, status, entries: reports };
  } catch (error) {
    return { ...base, status: 'failed', error: errorMessage(error) };
  }
}
