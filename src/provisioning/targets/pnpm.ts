import { asset } from '../../assets/ref';
import { home } from '../../host/path';
import type { CommandScope } from '../activation';
import { link, runCommand } from '../activation';
import { target } from '../target';

const brewPath = (s: CommandScope) => ({
  PATH: [`${s.ref('brewPrefix')}/bin`, s.basePath].filter(Boolean).join(':'),
});

const pnpmEnv = (s: CommandScope) => ({
  PNPM_HOME: `${s.home}/Library/pnpm`,
  PATH: [`${s.ref('brewPrefix')}/bin`, `${s.home}/Library/pnpm`, s.basePath]
    .filter(Boolean)
    .join(':'),
});

export const pnpmTarget = target('pnpm', {
  description: 'pnpm global packages',
  aliases: ['pn'],
  role: 'pnpm',
  packages: { formulae: ['pnpm'] },
  activations: [
    link(
      asset('pnpm/global/config.yaml'),
      home('Library/Preferences/pnpm/config.yaml'),
    ),
    runCommand({
      label: 'pnpm global packages',
      reads: { globalPackages: 'pnpm/global/global-packages.json' },
      steps: [
        {
          label: 'brew prefix',
          argv: () => ['brew', '--prefix'],
          capture: 'brewPrefix',
          changedWhen: 'never',
        },
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
          env: brewPath,
        },
        {
          label: 'pnpm add -g',
          argv: (s) => {
            const cfg = JSON.parse(s.ref('globalPackages')) as {
              dependencies?: Record<string, string>;
              globalPackages?: Record<string, string>;
            };
            const all = { ...cfg.dependencies, ...cfg.globalPackages };
            const pkgArgs = Object.entries(all).map(([k, v]) =>
              v ? `${k}@${v}` : k,
            );
            if (pkgArgs.length === 0) {
              throw new Error(
                'global-packages.json contains no packages to install.',
              );
            }
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
