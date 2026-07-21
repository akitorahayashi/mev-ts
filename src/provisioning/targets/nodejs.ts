import { asset } from '../../assets/ref';
import { home } from '../../host/path';
import { brewPath, brewPrefixCapture, link, runCommand } from '../activation';
import { target } from '../target';

export const nodejsTarget = target('nodejs', {
  description: 'Node.js via fnm',
  aliases: ['nd'],
  role: 'nodejs',
  packages: { formulae: ['fnm'] },
  activations: [
    link(asset('nodejs/.npmrc'), home('.npmrc')),
    runCommand({
      label: 'nodejs toolchain',
      reads: { version: 'nodejs/.node-version' },
      steps: [
        brewPrefixCapture(),
        {
          label: 'fnm install',
          argv: ['fnm', 'install', { ref: 'version' }, '--progress=never'],
          changedWhen: { outputNotContains: 'already installed' },
          env: brewPath(),
        },
        {
          label: 'fnm default',
          argv: ['fnm', 'default', { ref: 'version' }],
          changedWhen: 'never',
          env: brewPath(),
        },
      ],
    }),
  ],
});
