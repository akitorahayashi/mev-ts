import { asset } from '../../assets/ref';
import { home } from '../../host/path';
import { link, remoteInstaller } from '../activation';
import { target } from '../target';

const BUN_BINARY = { concat: [{ ref: 'home' }, '/.bun/bin/bun'] } as const;

export const bunTarget = target('bun', {
  description: 'Bun JavaScript runtime',
  aliases: ['b'],
  role: 'bun',
  activations: [
    link(asset('bun/.bunfig.toml'), home('.bunfig.toml')),
    remoteInstaller({
      label: 'install bun',
      url: 'https://bun.sh/install',
      // bun.sh publishes no checksum for its install script, so the unverified
      // posture is declared in the type rather than left implicit.
      integrity: { acknowledgedUnverified: true },
      interpreter: 'bash',
      // bun.sh/install selects the release from its positional `bun-v<version>`
      // argument, read from the role asset like every sibling toolchain version.
      // No `-s`: the script runs from a file, not stdin, so bash passes every
      // argument through positionally and the installer would read `-s` as the
      // release tag.
      reads: { version: 'bun/.bun-version' },
      args: [{ concat: ['bun-v', { ref: 'version' }] }],
      creates: home('.bun/bin/bun'),
      // The binary exists at every version, so presence alone would pin the
      // machine to whatever was installed first.
      skipIf: {
        commandOutputMatches: {
          argv: [BUN_BINARY, '--version'],
          exact: { ref: 'version' },
        },
      },
    }),
  ],
});
