import { asset } from '../../assets/ref';
import { home } from '../../host/path';
import { link, runCommand } from '../activation';
import { target } from '../target';

// bun.sh/install selects the release from its positional `bun-v<version>` arg.
// bun.sh publishes no checksum for the install script, so the pipe carries the
// same acknowledged-unverified posture as the previous remoteInstaller, with
// the curl flags mirroring the transport pinning of downloadOverHttps.
export const bunTarget = target('bun', {
  description: 'Bun JavaScript runtime',
  aliases: ['b'],
  role: 'bun',
  activations: [
    link(asset('bun/.bunfig.toml'), home('.bunfig.toml')),
    runCommand({
      label: 'bun toolchain',
      reads: { version: 'bun/.bun-version' },
      steps: [
        {
          label: 'install bun',
          argv: [
            'bash',
            '-c',
            {
              concat: [
                `curl --proto '=https' --proto-redir '=https' --tlsv1.2 -fsSL https://bun.sh/install | bash -s "bun-v`,
                { ref: 'version' },
                '"',
              ],
            },
          ],
          skipIf: {
            commandSucceeds: [
              'sh',
              '-c',
              {
                concat: [
                  '"',
                  { ref: 'home' },
                  '/.bun/bin/bun" --version | grep -qx "',
                  { ref: 'version' },
                  '"',
                ],
              },
            ],
          },
        },
      ],
    }),
  ],
});
