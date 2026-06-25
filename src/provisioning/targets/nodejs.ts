import { asset } from '../../assets/ref';
import { home } from '../../host/path';
import type { CommandScope } from '../activation';
import { link, runCommand } from '../activation';
import { target } from '../target';

const brewPath = (s: CommandScope) => ({
  PATH: [`${s.ref('brewPrefix')}/bin`, s.basePath].filter(Boolean).join(':'),
});

export const nodejsTarget = target('nodejs', {
  description: 'Node.js via fnm',
  aliases: ['nd'],
  role: 'nodejs',
  packages: { formulae: ['fnm'] },
  activations: [
    link(asset('nodejs/global/.npmrc'), home('.npmrc')),
    runCommand({
      label: 'nodejs toolchain',
      reads: { version: 'nodejs/global/.node-version' },
      steps: [
        {
          label: 'brew prefix',
          argv: () => ['brew', '--prefix'],
          capture: 'brewPrefix',
          changedWhen: 'never',
        },
        {
          label: 'fnm install',
          argv: (s) => ['fnm', 'install', s.ref('version'), '--progress=never'],
          changedWhen: { outputNotContains: 'already installed' },
          env: brewPath,
        },
        {
          label: 'fnm default',
          argv: (s) => ['fnm', 'default', s.ref('version')],
          changedWhen: 'never',
          env: brewPath,
        },
      ],
    }),
  ],
});
