import { asset } from '../../assets/ref';
import { home } from '../../host/path';
import {
  link,
  remoteInstaller,
  runCommand,
  versionCheckStep,
} from '../activation';
import { target } from '../target';

const INSTALL_DIR = { concat: [{ ref: 'home' }, '/.local/bin'] } as const;
const BINARY = { concat: [INSTALL_DIR, '/herdr'] } as const;

export const herdrTarget = target('herdr', {
  description: 'Herdr terminal workspace and agent manager',
  aliases: ['hd'],
  role: 'herdr',
  activations: [
    link(asset('herdr/config.toml'), home('.config/herdr/config.toml')),
    remoteInstaller({
      label: 'install Herdr',
      url: 'https://herdr.dev/install.sh',
      // Herdr publishes no checksum for the installer; the installer verifies
      // the selected release binary against the official manifest's SHA256.
      integrity: { acknowledgedUnverified: true },
      interpreter: 'sh',
      args: [],
      creates: home('.local/bin/herdr'),
      upgrade: {
        label: 'herdr update',
        argv: [BINARY, 'update'],
        changedWhen: { outputNotContains: 'already up to date' },
        blockedWhen: {
          errorContains:
            'run `herdr update` outside herdr after detaching from the session',
        },
      },
      env: { HERDR_INSTALL_DIR: INSTALL_DIR },
      pathPrefix: [home('.local/bin')],
    }),
    runCommand({
      label: 'Herdr CLI',
      steps: [versionCheckStep('herdr --version', BINARY)],
    }),
  ],
});
