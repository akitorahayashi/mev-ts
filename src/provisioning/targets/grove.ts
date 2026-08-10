import { asset } from '../../assets/ref';
import { home } from '../../host/path';
import { groveConfig, releaseBinaries } from '../activation';
import { target } from '../target';

export const groveTarget = target('grove', {
  description: 'Repository workspace configuration and Grove CLI',
  aliases: ['gv'],
  role: 'grove',
  // The SSH host alias is rendered into the deployed grove.toml, so a change to
  // it leaves this target's applied output stale.
  perMachineInputs: ['githubSshHost'],
  activations: [
    releaseBinaries('grove/binaries.yml'),
    groveConfig(asset('grove/grove.toml'), home('Desktop/grove.toml')),
  ],
});
