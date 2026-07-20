import { asset } from '../../assets/ref';
import { errorMessage, ProvisioningError } from '../../errors';
import { isRecord } from '../../host/parse';
import { home } from '../../host/path';
import type { CommandScope } from '../activation';
import { brewPath, brewPrefixCapture, link, runCommand } from '../activation';
import { target } from '../target';

const pnpmEnv = (s: CommandScope) => ({
  PNPM_HOME: `${s.home}/Library/pnpm`,
  ...brewPath(s, [`${s.home}/Library/pnpm`]),
});

function isPackageMap(value: unknown): value is Record<string, string> {
  return (
    isRecord(value) &&
    Object.values(value).every((version) => typeof version === 'string')
  );
}

export function globalPackageArgs(raw: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new ProvisioningError(
      `Failed to parse pnpm global packages manifest as JSON: ${errorMessage(error)}`,
    );
  }
  if (!isRecord(parsed)) {
    throw new ProvisioningError(
      'pnpm global packages manifest must be an object.',
    );
  }
  const { dependencies, globalPackages } = parsed;
  if (dependencies !== undefined && !isPackageMap(dependencies)) {
    throw new ProvisioningError(
      'pnpm global packages manifest dependencies must be an object of string versions.',
    );
  }
  if (globalPackages !== undefined && !isPackageMap(globalPackages)) {
    throw new ProvisioningError(
      'pnpm global packages manifest globalPackages must be an object of string versions.',
    );
  }
  const all = { ...dependencies, ...globalPackages };
  const pkgArgs = Object.entries(all).map(([name, version]) =>
    version ? `${name}@${version}` : name,
  );
  if (pkgArgs.length === 0) {
    throw new ProvisioningError(
      'pnpm global packages manifest contains no packages to install.',
    );
  }
  return pkgArgs;
}

export const pnpmTarget = target('pnpm', {
  description: 'pnpm global packages',
  aliases: ['pn'],
  role: 'pnpm',
  packages: { formulae: ['pnpm'] },
  activations: [
    link(
      asset('pnpm/config.yaml'),
      home('Library/Preferences/pnpm/config.yaml'),
    ),
    runCommand({
      label: 'pnpm global packages',
      reads: { globalPackages: 'pnpm/global-packages.json' },
      steps: [
        brewPrefixCapture(),
        {
          label: 'verify nodejs runtime',
          argv: () => [
            'fnm',
            'exec',
            '--using=default',
            '--',
            'node',
            '--version',
          ],
          changedWhen: 'never',
          env: (s) => brewPath(s),
        },
        {
          label: 'pnpm add -g',
          argv: (s) => {
            const pkgArgs = globalPackageArgs(s.ref('globalPackages'));
            return [
              'fnm',
              'exec',
              '--using=default',
              '--',
              `${s.ref('brewPrefix')}/bin/pnpm`,
              'add',
              '-g',
              ...pkgArgs,
            ];
          },
          changedWhen: 'always',
          env: pnpmEnv,
        },
      ],
    }),
  ],
});
