import { asset } from '../../assets/ref';
import { home } from '../../host/path';
import {
  link,
  remoteInstaller,
  runCommand,
  versionCheckStep,
} from '../activation';
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
      steps: [
        versionCheckStep('bun --version', {
          concat: [{ ref: 'home' }, '/.bun/bin/bun'],
        }),
      ],
    }),
  ],
});
