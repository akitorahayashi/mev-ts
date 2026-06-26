import { asset } from '../../assets/ref';
import { home } from '../../host/path';
import { installExtensions, link } from '../activation';
import { target } from '../target';

const USER_DIR = 'Library/Application Support/Code/User';

export const vscodeTarget = target('vscode', {
  description: 'Visual Studio Code configuration and extensions',
  aliases: ['co'],
  role: 'editor/vscode',
  packages: { casks: ['visual-studio-code'] },
  activations: [
    link(
      asset('editor/vscode/global/settings.json'),
      home(`${USER_DIR}/settings.json`),
    ),
    link(
      asset('editor/vscode/global/keybindings.json'),
      home(`${USER_DIR}/keybindings.json`),
    ),
    installExtensions('code', 'editor/vscode/global/extensions.json'),
  ],
});
