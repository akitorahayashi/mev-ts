import { asset } from '../../assets/ref';
import { home } from '../../host/path';
import { installExtensions, link } from '../activation';
import { target } from '../target';

const USER_DIR = 'Library/Application Support/Antigravity IDE/User';

export const antigravityIdeTarget = target('antigravity_ide', {
  description: 'Antigravity IDE configuration and extensions',
  aliases: ['antigravity-ide', 'agi'],
  role: 'antigravity_ide',
  packages: { casks: ['antigravity-ide'] },
  activations: [
    link(
      asset('antigravity_ide/settings.json'),
      home(`${USER_DIR}/settings.json`),
    ),
    link(
      asset('antigravity_ide/keybindings.json'),
      home(`${USER_DIR}/keybindings.json`),
    ),
    installExtensions('agy-ide', 'antigravity_ide/extensions.json'),
  ],
});
