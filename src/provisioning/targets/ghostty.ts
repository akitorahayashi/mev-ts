import { asset } from '../../assets/ref';
import { home } from '../../host/path';
import { link } from '../activation';
import { target } from '../target';

export const ghosttyTarget = target('ghostty', {
  description: 'Ghostty terminal emulator configuration',
  aliases: ['gst'],
  role: 'ghostty',
  packages: { casks: ['ghostty'] },
  activations: [
    link(asset('ghostty/global/config'), home('.config/ghostty/config')),
  ],
});
