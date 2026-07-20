import { asset } from '../../assets/ref';
import { home } from '../../host/path';
import { link } from '../activation';
import { target } from '../target';

export const ghosttyTarget = target('ghostty', {
  description: 'Ghostty terminal emulator configuration',
  aliases: ['gst'],
  role: 'ghostty',
  packages: { casks: ['ghostty'] },
  activations: [link(asset('ghostty/config'), home('.config/ghostty/config'))],
});
