import { readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
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

type DutiActivation = Extract<Activation, { kind: 'duti' }>;

export function applyDuti(configKey: string): Activation {
  return { kind: 'duti', configKey };
}

export function describeDuti(activation: DutiActivation): Described {
  return {
    verb: 'apply',
    source: basename(activation.configKey, extname(activation.configKey)),
    dest: 'file associations',
  };
}

interface DutiApp {
  readonly bundle_id: string;
  readonly extensions: readonly string[];
}

interface DutiConfig {
  readonly default_apps: readonly DutiApp[];
}

interface DutiEntry {
  readonly bundleId: string;
  readonly extension: string;
}

async function readDutiEntries(
  configKey: string,
  home: string,
): Promise<DutiEntry[]> {
  const { load } = await import('js-yaml');
  const path = deployedPath({ key: configKey }, home);
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch {
    throw new ProvisioningError(
      `Duti config file not found: ${path}. Run without --plan to deploy first.`,
    );
  }
  const parsed = load(raw) as DutiConfig;
  if (!parsed?.default_apps || !Array.isArray(parsed.default_apps)) {
    throw new ProvisioningError(
      `Duti config must contain a default_apps sequence: ${path}`,
    );
  }
  return parsed.default_apps.flatMap((app: DutiApp) => {
    if (!app?.bundle_id || !Array.isArray(app?.extensions)) {
      throw new ProvisioningError(
        `Invalid entry in duti config: each app must have a bundle_id and an extensions array.`,
      );
    }
    return app.extensions.map((extension: string) => ({
      bundleId: app.bundle_id,
      extension,
    }));
  });
}

async function currentBundleId(
  extension: string,
  context: Context,
): Promise<string | null> {
  const result = await context.commands.run('duti', ['-x', extension]);
  if (result.code !== 0) return null;
  const lines = result.stdout.trimEnd().split('\n');
  const lastLine = lines.at(-1)?.trim();
  return lastLine || null;
}

export async function runDuti(
  activation: DutiActivation,
  context: Context,
  plan: boolean,
): Promise<ActivationReport> {
  const base = describeDuti(activation);
  try {
    const entries = await readDutiEntries(activation.configKey, context.home);
    if (plan) {
      return { ...base, status: 'changed' };
    }
    const reports: StepReport[] = [];
    let failed = false;
    let changed = false;

    for (const { bundleId, extension } of entries) {
      const current = await currentBundleId(extension, context);
      if (current === bundleId) {
        reports.push({ key: extension, value: bundleId, status: 'unchanged' });
        continue;
      }
      const result = await context.commands.run('duti', [
        '-s',
        bundleId,
        `.${extension}`,
        'all',
      ]);
      if (result.code !== 0) {
        reports.push({
          key: extension,
          value: bundleId,
          status: 'failed',
          error: result.stderr.trim() || `exit code ${result.code}`,
        });
        failed = true;
      } else {
        reports.push({ key: extension, value: bundleId, status: 'changed' });
        changed = true;
      }
    }

    const status = failed ? 'failed' : changed ? 'changed' : 'unchanged';
    return { ...base, status, entries: reports };
  } catch (error) {
    return { ...base, status: 'failed', error: errorMessage(error) };
  }
}
