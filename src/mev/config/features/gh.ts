import { brew } from '../../providers/brew';
import { fs } from '../../providers/filesystem';
import { asset } from '../../resources/asset';
import { home } from '../../resources/path';
import { feature } from '../feature';

const ghconfig = asset('gh/global/config.yml');

export const ghFeature = feature('gh', {
  tags: ['gh'],
  resources: [
    brew.formula('gh'),
    fs.deployAsset(ghconfig),
    fs.symlink(ghconfig, home('.config/gh/config.yml')),
  ],
});
