import { brew } from '../../providers/brew';
import { fs } from '../../providers/filesystem';
import { git } from '../../providers/git';
import { asset } from '../../resources/asset';
import { home } from '../../resources/path';
import { feature } from '../feature';

const gitconfig = asset('git/global/.gitconfig');
const gitignore = asset('git/global/.gitignore_global');
const configLink = fs.symlink(gitconfig, home('.config/git/config'));
const gitignoreLink = fs.symlink(gitignore, home('.gitignore_global'));

export const gitFeature = feature('git', {
  description: 'Git configuration and global gitignore',
  tags: ['git'],
  resources: [
    brew.formula('git'),
    fs.deployAsset(gitconfig),
    fs.deployAsset(gitignore),
    configLink,
    gitignoreLink,
    git.config('core.excludesfile', home('.gitignore_global'), {
      after: [configLink, gitignoreLink],
    }),
  ],
});
