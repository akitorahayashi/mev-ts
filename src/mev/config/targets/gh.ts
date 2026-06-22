import { brew } from '../../providers/brew';
import { fs } from '../../providers/filesystem';
import { asset } from '../../resources/asset';
import { home } from '../../resources/path';
import { target } from '../target';

const ghconfig = asset('gh/global/config.yml');

export const ghTarget = target('gh', {
  description: 'GitHub CLI configuration and label management',
  tags: ['gh'],
  resources: [
    brew.formula('gh'),
    fs.deployAsset(ghconfig),
    fs.symlink(ghconfig, home('.config/gh/config.yml')),
  ],
});
