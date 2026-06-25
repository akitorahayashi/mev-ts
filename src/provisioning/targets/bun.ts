import { asset } from '../../assets/ref';
import { home } from '../../host/path';
import { link, runCommand } from '../activation';
import { target } from '../target';

export const bunTarget = target('bun', {
  description: 'Bun JavaScript runtime',
  aliases: ['b'],
  role: 'bun',
  activations: [
    link(asset('bun/global/.bunfig.toml'), home('.bunfig.toml')),
    runCommand({
      label: 'bun toolchain',
      steps: [
        {
          label: 'install bun',
          argv: () => [
            'sh',
            '-c',
            'set -o pipefail; curl -fsSL https://bun.sh/install | bash',
          ],
          skipIf: (s) => ({ pathExists: `${s.home}/.bun/bin/bun` }),
          changedWhen: 'always',
        },
        {
          label: 'bun --version',
          argv: (s) => [`${s.home}/.bun/bin/bun`, '--version'],
          changedWhen: 'never',
        },
      ],
    }),
  ],
});
