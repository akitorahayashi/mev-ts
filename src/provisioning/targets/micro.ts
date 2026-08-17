import { asset } from '../../assets/ref';
import { home } from '../../host/path';
import { declaredKeys } from '../activation';
import { target } from '../target';

export const microTarget = target('micro', {
  description: 'Micro terminal editor configuration',
  aliases: ['mi'],
  role: 'micro',
  packages: { formulae: ['micro'] },
  activations: [
    // Merged, not linked: Micro rewrites settings.json in place whenever a
    // setting is changed globally, so a symlink into the deploy store would
    // route those writes into the deployed role and every deploy would wipe
    // them (see docs/architecture/app-owned-config.md).
    declaredKeys(
      asset('micro/settings.json'),
      home('.config/micro/settings.json'),
      'json',
    ),
  ],
});
