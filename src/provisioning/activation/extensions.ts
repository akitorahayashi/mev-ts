import { readFile } from 'node:fs/promises';
import { deployedPath } from '../../assets/ref';
import { ProvisioningError } from '../../errors';
import type { Context } from '../../host/context';
import {
  type Activation,
  type ActivationReport,
  type Described,
  errorMessage,
  type StepReport,
} from './contract';

type ExtensionsActivation = Extract<Activation, { kind: 'editorExtensions' }>;

export function installExtensions(
  command: string,
  configKey: string,
): Activation {
  return { kind: 'editorExtensions', command, configKey };
}

export function describeExtensions(
  activation: ExtensionsActivation,
): Described {
  return { verb: 'apply', source: activation.command, dest: 'extensions' };
}

interface ExtensionsConfig {
  readonly extensions: readonly string[];
}

async function readDesired(configKey: string, home: string): Promise<string[]> {
  const path = deployedPath({ key: configKey }, home);
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch {
    throw new ProvisioningError(
      `Extensions manifest not found: ${path}. Run without --plan to deploy first.`,
    );
  }
  const parsed = JSON.parse(raw) as ExtensionsConfig;
  if (!parsed?.extensions || !Array.isArray(parsed.extensions)) {
    throw new ProvisioningError(
      `Extensions manifest must contain an extensions array: ${path}`,
    );
  }
  return [...parsed.extensions];
}

async function readInstalled(
  command: string,
  context: Context,
): Promise<Set<string>> {
  const result = await context.commands.run(command, ['--list-extensions']);
  if (result.code !== 0) {
    throw new ProvisioningError(
      `${command} --list-extensions failed: ${result.stderr.trim() || `exit code ${result.code}`}. Is ${command} installed and on PATH?`,
    );
  }
  return new Set(
    result.stdout
      .split('\n')
      .map((line) => line.trim().toLowerCase())
      .filter(Boolean),
  );
}

export async function runExtensions(
  activation: ExtensionsActivation,
  context: Context,
  plan: boolean,
): Promise<ActivationReport> {
  const base = describeExtensions(activation);
  try {
    const desired = await readDesired(activation.configKey, context.home);
    if (plan) {
      return { ...base, status: 'changed' };
    }
    const installed = await readInstalled(activation.command, context);

    const entries: StepReport[] = [];
    let failed = false;
    let changed = false;
    for (const extension of desired) {
      if (installed.has(extension.toLowerCase())) {
        entries.push({
          key: extension,
          value: 'up to date',
          status: 'unchanged',
        });
        continue;
      }
      const result = await context.commands.run(activation.command, [
        '--install-extension',
        extension,
      ]);
      if (result.code !== 0) {
        entries.push({
          key: extension,
          value: 'install',
          status: 'failed',
          error: result.stderr.trim() || `exit code ${result.code}`,
        });
        failed = true;
        continue;
      }
      changed = true;
      entries.push({ key: extension, value: 'installed', status: 'changed' });
    }

    const status = failed ? 'failed' : changed ? 'changed' : 'unchanged';
    return { ...base, status, entries };
  } catch (error) {
    return { ...base, status: 'failed', error: errorMessage(error) };
  }
}
