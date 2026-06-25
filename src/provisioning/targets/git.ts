import { asset } from '../../assets/ref';
import { home } from '../../host/path';
import { link } from '../activation';
import { target } from '../target';

// `~/.config/git/ignore` is read automatically by git under the XDG default, so
// linking the deployed gitignore there removes the need to set
// `core.excludesfile` as a separate config operation.
export const gitTarget = target('git', {
  description: 'Git configuration and global gitignore',
  role: 'git',
  packages: { formulae: ['git'] },
  activations: [
    link(asset('git/global/.gitconfig'), home('.config/git/config')),
    link(asset('git/global/.gitignore_global'), home('.config/git/ignore')),
  ],
});
