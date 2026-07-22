import { asset } from '../../assets/ref';
import { home } from '../../host/path';
import { link, runCommand } from '../activation';
import { target } from '../target';

export const bunTarget = target('bun', {
  description: 'Bun JavaScript runtime',
  aliases: ['b'],
  role: 'bun',
  activations: [
    link(asset('bun/.bunfig.toml'), home('.bunfig.toml')),
    runCommand({
      label: 'bun toolchain',
      intentVersion: 2,
      reads: { version: 'bun/.bun-version' },
      steps: [
        {
          label: 'install bun',
          // bun.sh/install selects the release from its positional version arg;
          // the hardened curl flags mirror the transport pinning that the
          // remoteInstaller runner applies to every download.
          argv: (s) => [
            'bash',
            '-c',
            `curl --proto '=https' --proto-redir '=https' --tlsv1.2 -fsSL https://bun.sh/install | bash -s "bun-v${s.ref('version')}"`,
          ],
          skipIf: (s) => ({
            commandSucceeds: [
              'sh',
              '-c',
              `"${s.home}/.bun/bin/bun" --version | grep -qx "${s.ref('version')}"`,
            ],
          }),
        },
      ],
    }),
  ],
});
