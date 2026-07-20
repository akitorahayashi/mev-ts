import { asset } from '../../assets/ref';
import { home } from '../../host/path';
import { installExtensions, link } from '../activation';
import { target } from '../target';

const USER_DIR = 'Library/Application Support/Code/User';

export const vscodeTarget = target('vscode', {
  description: 'Visual Studio Code configuration and extensions',
  aliases: ['co'],
  role: 'vscode',
  packages: { casks: ['visual-studio-code'] },
  activations: [
    link(asset('vscode/settings.json'), home(`${USER_DIR}/settings.json`)),
    link(
      asset('vscode/keybindings.json'),
      home(`${USER_DIR}/keybindings.json`),
    ),
    installExtensions('code', 'vscode/extensions.json'),
  ],
});
