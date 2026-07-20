import { asset } from '../../assets/ref';
import { home } from '../../host/path';
import { link, linkTree } from '../activation';
import { target } from '../target';

export const nvimTarget = target('nvim', {
  description: 'Neovim configuration',
  aliases: ['nv'],
  role: 'nvim',
  packages: { formulae: ['neovim'] },
  activations: [
    link(asset('nvim/.vimrc'), home('.vimrc')),
    linkTree('nvim/', home('.config/nvim')),
  ],
});
