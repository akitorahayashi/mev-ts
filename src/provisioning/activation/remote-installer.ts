import { chmod, mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { ProvisioningError } from '../../errors';
import { statIfPresent } from '../../host/absence';
import { runWithCleanup } from '../../host/cleanup-error';
import { formatCommandFailure } from '../../host/command';
import { runProcessStep } from '../../host/command-run';
import type { Context } from '../../host/context';
import { downloadOverHttps } from '../../host/https-download';
import { resolveHostPath, symbolic } from '../../host/path';
import {
  guardMatches,
  readBindings,
  resolveArgs,
  resolveEnv,
  resolveGuard,
  runCommandStep,
  scopeFor,
} from './command';
import type {
  Activation,
  ActivationReport,
  ActivationRunOptions,
  CommandScope,
  Described,
  RemoteInstallerUpgrade,
  StepReport,
} from './contract';
import { guarded } from './reconcile';

type RemoteInstallerActivation = Extract<
  Activation,
  { kind: 'remoteInstaller' }
>;

export function remoteInstaller(
  input: Omit<RemoteInstallerActivation, 'kind'>,
): Activation {
  return { kind: 'remoteInstaller', ...input };
}

export function describeRemoteInstaller(
  activation: RemoteInstallerActivation,
): Described {
  return {
    verb: 'run',
    source: activation.label,
    dest: symbolic(activation.creates),
  };
}

function parseSha256(raw: string, label: string): string {
  const [hash] = raw.trim().split(/\s+/);
  if (!hash || !/^[a-fA-F0-9]{64}$/.test(hash)) {
    throw new ProvisioningError(
      `Invalid SHA256 checksum document for ${label}.`,
    );
  }
  return hash.toLowerCase();
}

async function verifyChecksum(
  activation: RemoteInstallerActivation,
  context: Context,
  script: string,
  checksumPath: string,
): Promise<void> {
  if ('acknowledgedUnverified' in activation.integrity) return;
  await downloadOverHttps(
    context.commands,
    activation.integrity.checksumUrl,
    checksumPath,
    `${activation.label} checksum`,
  );
  const expected = parseSha256(
    await readFile(checksumPath, 'utf8'),
    activation.label,
  );
  const actualResult = await runProcessStep(
    context.commands,
    'shasum',
    ['-a', '256', script],
    `shasum verification failed for ${activation.label}`,
  );
  const actual = parseSha256(actualResult.stdout, activation.label);
  if (actual !== expected) {
    throw new ProvisioningError(
      `SHA256 mismatch for ${activation.label}: expected ${expected}, got ${actual}.`,
    );
  }
}

async function runInstaller(
  activation: RemoteInstallerActivation,
  context: Context,
  script: string,
  scope: CommandScope,
): Promise<void> {
  const args = resolveArgs(activation.args, scope);
  if (activation.interpreter === 'direct') {
    await chmod(script, 0o755);
    await runProcessStep(
      context.commands,
      script,
      args,
      `installer failed for ${activation.label}`,
      { env: installerEnv(activation, context, scope) },
    );
    return;
  }
  await runProcessStep(
    context.commands,
    activation.interpreter,
    [script, ...args],
    `${activation.interpreter} installer failed for ${activation.label}`,
    { env: installerEnv(activation, context, scope) },
  );
}

function installerEnv(
  activation: RemoteInstallerActivation,
  context: Context,
  scope: CommandScope,
): Readonly<Record<string, string>> | undefined {
  const env = resolveEnv(activation.env ?? {}, scope);
  const pathPrefix = activation.pathPrefix?.map((path) =>
    resolveHostPath(path, context.home),
  );
  if (pathPrefix && pathPrefix.length > 0) {
    env['PATH'] = [...pathPrefix, context.basePath].filter(Boolean).join(':');
  }
  return Object.keys(env).length > 0 ? env : undefined;
}

async function installerSatisfied(
  activation: RemoteInstallerActivation,
  context: Context,
  scope: CommandScope,
): Promise<boolean> {
  if (activation.skipIf) {
    return guardMatches(resolveGuard(activation.skipIf, scope), context, {
      env: installerEnv(activation, context, scope),
    });
  }
  return (
    (await statIfPresent(resolveHostPath(activation.creates, context.home))) !==
    null
  );
}

function unsatisfiedInstallerError(
  activation: RemoteInstallerActivation,
): ProvisioningError {
  const postcondition = activation.skipIf
    ? 'its declared post-install guard'
    : symbolic(activation.creates);
  return new ProvisioningError(
    `${activation.label} completed without satisfying ${postcondition}.`,
  );
}

interface VersionProbeResult {
  readonly version?: string;
  readonly error?: string;
}

async function probeUpgradeVersion(
  upgrade: RemoteInstallerUpgrade,
  scope: CommandScope,
  context: Context,
): Promise<VersionProbeResult> {
  const argv = resolveArgs(upgrade.versionProbe, scope);
  const [command, ...args] = argv;
  if (!command) {
    throw new ProvisioningError(
      `${upgrade.label} version probe produced no argv.`,
    );
  }
  const env = upgrade.env ? resolveEnv(upgrade.env, scope) : undefined;
  const result = await context.commands.run(command, args, { env });
  if (result.code !== 0) {
    return {
      error: formatCommandFailure(
        `${upgrade.label} version probe failed`,
        result,
      ),
    };
  }
  const version = result.stdout.trim();
  return version
    ? { version }
    : { error: `${upgrade.label} version probe returned empty output.` };
}

function classifyUpgrade(
  entry: StepReport,
  before: string,
  after: VersionProbeResult,
): StepReport {
  if (after.version === undefined) {
    return {
      ...entry,
      status: 'failed',
      error: after.error ?? 'Version verification failed.',
    };
  }
  return before === after.version
    ? {
        ...entry,
        value: `already latest (${after.version})`,
        status: 'unchanged',
      }
    : {
        ...entry,
        value: `${before} -> ${after.version}`,
        status: 'changed',
      };
}

export async function runRemoteInstaller(
  activation: RemoteInstallerActivation,
  context: Context,
  options: ActivationRunOptions = { upgrade: false },
): Promise<ActivationReport> {
  const base = describeRemoteInstaller(activation);
  return guarded(base, async () => {
    const bindings = await readBindings(activation.reads ?? {}, context);
    const scope = scopeFor(bindings);
    const upgrade = options.upgrade ? activation.upgrade : undefined;
    const before = upgrade
      ? await probeUpgradeVersion(upgrade, scope, context)
      : undefined;
    const satisfied = upgrade
      ? before?.version !== undefined
      : await installerSatisfied(activation, context, scope);
    if (satisfied) {
      if (upgrade && before?.version !== undefined) {
        const entry = await runCommandStep(upgrade, bindings, context);
        if (
          entry.status === 'failed' &&
          upgrade.blockedWhen &&
          entry.error?.includes(upgrade.blockedWhen.errorContains)
        ) {
          return { ...base, status: 'blocked', error: entry.error };
        }
        if (entry.status === 'failed') {
          return { ...base, status: 'failed', entries: [entry] };
        }
        const classified = classifyUpgrade(
          entry,
          before.version,
          await probeUpgradeVersion(upgrade, scope, context),
        );
        return { ...base, status: classified.status, entries: [classified] };
      }
      return { ...base, status: 'unchanged' };
    }
    const workspace = await mkdtemp(join(context.tmpRoot, 'mev-installer-'));
    await runWithCleanup(
      async () => {
        const script = join(workspace, 'install');
        await downloadOverHttps(
          context.commands,
          activation.url,
          script,
          activation.label,
        );
        await verifyChecksum(
          activation,
          context,
          script,
          join(workspace, 'install.sha256'),
        );
        await runInstaller(activation, context, script, scope);
      },
      () => rm(workspace, { force: true, recursive: true }),
      `Failed to clean up remote installer workspace ${workspace}.`,
    );
    if (!(await installerSatisfied(activation, context, scope))) {
      throw unsatisfiedInstallerError(activation);
    }
    return { ...base, status: 'changed' };
  });
}
