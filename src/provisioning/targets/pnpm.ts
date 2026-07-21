import { asset } from '../../assets/ref';
import { errorMessage, ProvisioningError } from '../../errors';
import { isRecord, requireExactKeys } from '../../host/parse';
import { home } from '../../host/path';
import type { CommandScope } from '../activation';
import { brewPath, brewPrefixCapture, link, runCommand } from '../activation';
import { target } from '../target';

const pnpmEnv = (s: CommandScope) => ({
  PNPM_HOME: `${s.home}/Library/pnpm`,
  ...brewPath(s, [`${s.home}/Library/pnpm`]),
});

function packageNameKey(name: string): string {
  return name.toLowerCase();
}

function packageMap(
  value: unknown,
  field: string,
): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    throw new ProvisioningError(
      `pnpm global packages manifest ${field} must be an object of string versions.`,
    );
  }
  for (const [name, version] of Object.entries(value)) {
    if (name.length === 0 || name.startsWith('-')) {
      throw new ProvisioningError(
        `pnpm global packages manifest ${field} contains an invalid package name '${name}'.`,
      );
    }
    if (typeof version !== 'string' || version.length === 0) {
      throw new ProvisioningError(
        `pnpm global packages manifest ${field}.${name} must be a non-empty string version.`,
      );
    }
  }
  return value as Record<string, string>;
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
  requireExactKeys(
    parsed,
    ['dependencies', 'globalPackages'],
    'pnpm global packages manifest',
  );
  const dependencies = packageMap(parsed['dependencies'], 'dependencies') ?? {};
  const globalPackages =
    packageMap(parsed['globalPackages'], 'globalPackages') ?? {};
  const dependencyNames = new Set(
    Object.keys(dependencies).map(packageNameKey),
  );
  for (const name of Object.keys(globalPackages)) {
    if (dependencyNames.has(packageNameKey(name))) {
      throw new ProvisioningError(
        `pnpm global packages manifest package '${name}' cannot occur in both dependencies and globalPackages.`,
      );
    }
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
      intentVersion: 1,
      reads: {
        globalPackages: {
          key: 'pnpm/global-packages.json',
          validate: globalPackageArgs,
        },
      },
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
