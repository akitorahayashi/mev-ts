import { asset } from '../../assets/ref';
import { home } from '../../host/path';
import { link } from '../activation';
import { target } from '../target';

export const cmuxTarget = target('cmux', {
  description: 'cmux terminal workspace configuration',
  aliases: ['cmx'],
  role: 'cmux',
  packages: { casks: ['cmux'] },
  activations: [
    link(asset('cmux/global/cmux.json'), home('.config/cmux/cmux.json')),
  ],
});
