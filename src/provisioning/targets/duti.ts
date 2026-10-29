import { applyDuti } from '../activation';
import { target } from '../target';

export const dutiTarget = target('duti', {
  description: 'macOS file association defaults via duti',
  aliases: ['du'],
  role: 'duti',
  activations: [applyDuti('duti/default_apps.yml')],
});
