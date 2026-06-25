import { asset } from '../../assets/ref';
import { home } from '../../host/path';
import { installExtensions, link } from '../activation';
import { target } from '../target';

const USER_DIR = 'Library/Application Support/Antigravity IDE/User';

export const antigravityIdeTarget = target('antigravity_ide', {
  description: 'Antigravity IDE configuration and extensions',
  aliases: ['antigravity-ide', 'agi'],
  role: 'editor/antigravity_ide',
  activations: [
    link(
      asset('editor/antigravity_ide/global/settings.json'),
      home(`${USER_DIR}/settings.json`),
    ),
    link(
      asset('editor/antigravity_ide/global/keybindings.json'),
      home(`${USER_DIR}/keybindings.json`),
    ),
    installExtensions(
      'agy-ide',
      'editor/antigravity_ide/global/extensions.json',
    ),
  ],
});
