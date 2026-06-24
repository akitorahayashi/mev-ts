import { asset } from '../../assets/ref';
import { home } from '../../host/path';
import { link, target } from '../target';

export const ghTarget = target('gh', {
  description: 'GitHub CLI configuration and label management',
  role: 'gh',
  packages: { formulae: ['gh'] },
  activations: [
    link(asset('gh/global/config.yml'), home('.config/gh/config.yml')),
  ],
});
