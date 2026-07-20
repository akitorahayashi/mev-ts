import { asset } from '../../assets/ref';
import { home, resolveHostPath } from '../../host/path';
import { preserveIdentityOverlay } from '../../identity/overlay';
import { link } from '../activation';
import { target } from '../target';

// `~/.config/git/ignore` is read automatically by git under the XDG default, so
// linking the deployed gitignore there removes the need to set
// `core.excludesfile` as a separate config operation.
export const gitTarget = target('git', {
  description: 'Git configuration and global gitignore',
  role: 'git',
  packages: { formulae: ['git'] },
  preserveBeforeDeploy: (context) =>
    preserveIdentityOverlay(
      { home: context.home, run: context.commands },
      resolveHostPath(home('.config/git/config'), context.home),
    ),
  activations: [
    link(asset('git/.gitconfig'), home('.config/git/config')),
    link(asset('git/.gitignore_global'), home('.config/git/ignore')),
  ],
});
