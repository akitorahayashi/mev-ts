import { asset } from '../../assets/ref';
import { home } from '../../host/path';
import { link, remoteInstaller, runCommand } from '../activation';
import { target } from '../target';

export const bunTarget = target('bun', {
  description: 'Bun JavaScript runtime',
  aliases: ['b'],
  role: 'bun',
  activations: [
    link(asset('bun/.bunfig.toml'), home('.bunfig.toml')),
    remoteInstaller({
      label: 'install bun',
      url: 'https://bun.sh/install',
      integrity: { acknowledgedUnverified: true },
      interpreter: 'bash',
      args: [],
      creates: home('.bun/bin/bun'),
    }),
    runCommand({
      label: 'bun toolchain',
      intentVersion: 1,
      steps: [
        {
          label: 'bun --version',
          argv: (s) => [`${s.home}/.bun/bin/bun`, '--version'],
          changedWhen: 'never',
        },
      ],
    }),
  ],
});
