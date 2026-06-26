import { asset } from '../../assets/ref';
import { home } from '../../host/path';
import { link, linkTree } from '../activation';
import { target } from '../target';

const dotfiles = ['.zshenv', '.zprofile', '.zshrc'];

// Alias fragments are mirrored under ~/.mev/alias as a single tree activation,
// sourced recursively by .zshrc. The fragment set is resolved from the embedded
// assets at activation time, so adding a fragment requires no change here.
export const shellTarget = target('shell', {
  description: 'Shell environment, dotfiles, and aliases',
  aliases: ['sh'],
  role: 'shell',
  // The interactive-shell toolset .zshrc sources or initializes at startup.
  packages: {
    formulae: [
      'fzf',
      'zoxide',
      'zsh-autosuggestions',
      'zsh-syntax-highlighting',
    ],
  },
  activations: [
    ...dotfiles.map((name) => link(asset(`shell/global/${name}`), home(name))),
    linkTree('shell/global/alias/', home('.mev/alias')),
  ],
});
