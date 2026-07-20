import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { errorMessage, ProvisioningError } from '../../errors';
import { lstatIfPresent } from '../../host/absence';
import { runWithCleanup } from '../../host/cleanup-error';
import { formatCommandFailure } from '../../host/command';
import type { Context } from '../../host/context';
import { resolveHostPath, symbolic } from '../../host/path';
import type { Activation, ActivationReport, Described } from './contract';

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

async function download(
  context: Context,
  label: string,
  url: string,
  output: string,
): Promise<void> {
  const result = await context.commands.run('curl', [
    '--proto',
    '=https',
    '--proto-redir',
    '=https',
    '--tlsv1.2',
    '-fsSL',
    '-o',
    output,
    '--',
    url,
  ]);
  if (result.code !== 0) {
    throw new ProvisioningError(
      formatCommandFailure(`curl download failed for ${label}`, result),
    );
  }
}

async function verifyChecksum(
  activation: RemoteInstallerActivation,
  context: Context,
  script: string,
  checksumPath: string,
): Promise<void> {
  if (!activation.checksumUrl) return;
  await download(
    context,
    `${activation.label} checksum`,
    activation.checksumUrl,
    checksumPath,
  );
  const expected = parseSha256(
    await readFile(checksumPath, 'utf8'),
    activation.label,
  );
  const actualResult = await context.commands.run('shasum', [
    '-a',
    '256',
    script,
  ]);
  if (actualResult.code !== 0) {
    throw new ProvisioningError(
      formatCommandFailure(
        `shasum verification failed for ${activation.label}`,
        actualResult,
      ),
    );
  }
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
): Promise<void> {
  if (activation.interpreter === 'direct') {
    const chmod = await context.commands.run('chmod', ['+x', script]);
    if (chmod.code !== 0) {
      throw new ProvisioningError(
        formatCommandFailure(
          `chmod failed for ${activation.label} installer`,
          chmod,
        ),
      );
    }
    const direct = await context.commands.run(script, activation.args, {
      env: installerEnv(activation, context),
    });
    if (direct.code !== 0) {
      throw new ProvisioningError(
        formatCommandFailure(
          `installer failed for ${activation.label}`,
          direct,
        ),
      );
    }
    return;
  }
  const interpreted = await context.commands.run(
    activation.interpreter,
    [script, ...activation.args],
    { env: installerEnv(activation, context) },
  );
  if (interpreted.code !== 0) {
    throw new ProvisioningError(
      formatCommandFailure(
        `${activation.interpreter} installer failed for ${activation.label}`,
        interpreted,
      ),
    );
  }
}

function installerEnv(
  activation: RemoteInstallerActivation,
  context: Context,
): Readonly<Record<string, string>> | undefined {
  const env: Record<string, string> = { ...activation.env };
  const pathPrefix = activation.pathPrefix?.map((path) =>
    resolveHostPath(path, context.home),
  );
  if (pathPrefix && pathPrefix.length > 0) {
    env.PATH = [...pathPrefix, context.basePath].filter(Boolean).join(':');
  }
  return Object.keys(env).length > 0 ? env : undefined;
}

export async function runRemoteInstaller(
  activation: RemoteInstallerActivation,
  context: Context,
): Promise<ActivationReport> {
  const base = describeRemoteInstaller(activation);
  try {
    if (
      await lstatIfPresent(resolveHostPath(activation.creates, context.home))
    ) {
      return { ...base, status: 'unchanged' };
    }
    const workspace = await mkdtemp(join(tmpdir(), 'mev-installer-'));
    await runWithCleanup(
      async () => {
        const script = join(workspace, 'install');
        await download(context, activation.label, activation.url, script);
        await verifyChecksum(
          activation,
          context,
          script,
          join(workspace, 'install.sha256'),
        );
        await runInstaller(activation, context, script);
      },
      () => rm(workspace, { force: true, recursive: true }),
      `Failed to clean up remote installer workspace ${workspace}.`,
    );
    return { ...base, status: 'changed' };
  } catch (error) {
    return { ...base, status: 'failed', error: errorMessage(error) };
  }
}
