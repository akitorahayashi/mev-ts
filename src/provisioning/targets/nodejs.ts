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
          report: {
            kind: 'reconcile',
            subject: 'Node.js runtime',
            changed: { concat: ['installed ', { ref: 'version' }] },
            unchanged: { concat: [{ ref: 'version' }, ' already installed'] },
          },
          env: brewPath(),
        },
        {
          label: 'fnm default',
          argv: ['fnm', 'default', { ref: 'version' }],
          skipIf: {
            commandOutputMatches: {
              argv: ['fnm', 'default'],
              contains: { ref: 'version' },
            },
          },
          report: {
            kind: 'reconcile',
            subject: 'default Node.js runtime',
            changed: { concat: ['set to ', { ref: 'version' }] },
            unchanged: { concat: [{ ref: 'version' }, ' already selected'] },
          },
          env: brewPath(),
        },
      ],
    }),
  ],
});
