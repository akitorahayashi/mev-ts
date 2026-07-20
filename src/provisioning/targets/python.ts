import { asset } from '../../assets/ref';
import { home } from '../../host/path';
import { brewPath, brewPrefixCapture, link, runCommand } from '../activation';
import { target } from '../target';

export const pythonTarget = target('python', {
  description: 'Python via uv',
  aliases: ['py'],
  role: 'python',
  packages: { formulae: ['uv'] },
  activations: [
    link(asset('python/uv.toml'), home('.config/uv/uv.toml')),
    runCommand({
      label: 'python toolchain',
      reads: { version: 'python/.python-version' },
      steps: [
        brewPrefixCapture(),
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
          env: (s) => brewPath(s),
        },
      ],
    }),
  ],
});
