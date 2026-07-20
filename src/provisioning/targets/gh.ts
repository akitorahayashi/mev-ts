import { asset } from '../../assets/ref';
import { home } from '../../host/path';
import { link } from '../activation';
import { target } from '../target';

export const ghTarget = target('gh', {
  description: 'GitHub CLI configuration and label management',
  role: 'gh',
  packages: { formulae: ['gh'] },
  activations: [link(asset('gh/config.yml'), home('.config/gh/config.yml'))],
});
