import { asset } from '../../assets/ref';
import { home } from '../../host/path';
import { groveConfig, releaseBinaries } from '../activation';
import { target } from '../target';

export const groveTarget = target('grove', {
  description: 'Repository workspace configuration and Grove CLI',
  aliases: ['gv'],
  role: 'grove',
  activations: [
    releaseBinaries('grove/binaries.yml'),
    groveConfig(asset('grove/grove.toml'), home('Desktop/grove.toml')),
  ],
});
