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
    // Merged, not linked: Micro rewrites this file at runtime; a symlink
    // would route those writes into the deployed role (app-owned-config.md).
    // Format is jsonc: Micro parses via JSON5, so a hand-edited comment or
    // trailing comma must survive, not fail strict JSON.
    declaredKeys(
      asset('micro/settings.json'),
      home('.config/micro/settings.json'),
      'jsonc',
    ),
  ],
});
