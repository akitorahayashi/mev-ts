import { asset } from '../../assets/ref';
import { home } from '../../host/path';
import type { CommandScope } from '../activation';
import { link, runCommand } from '../activation';
import { target } from '../target';

const brewPath = (s: CommandScope) => ({
  PATH: [`${s.ref('brewPrefix')}/bin`, s.basePath].filter(Boolean).join(':'),
});

export const pythonTarget = target('python', {
  description: 'Python via uv',
  aliases: ['py'],
  role: 'python',
  packages: { formulae: ['uv'] },
  activations: [
    link(asset('python/global/uv.toml'), home('.config/uv/uv.toml')),
    runCommand({
      label: 'python toolchain',
      reads: { version: 'python/global/.python-version' },
      steps: [
        {
          label: 'brew prefix',
          argv: () => ['brew', '--prefix'],
          capture: 'brewPrefix',
          changedWhen: 'never',
        },
        {
          label: 'uv python install',
          argv: (s) => [
            'uv',
            'python',
            'install',
            s.ref('version'),
            '--default',
            '--no-progress',
          ],
          changedWhen: { outputContains: 'Installed Python' },
          env: brewPath,
        },
      ],
    }),
  ],
});
