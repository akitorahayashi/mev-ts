import { asset } from '../../assets/ref';
import { home } from '../../host/path';
import { OVERRIDES_PREFIX } from '../../zed/paths';
import { link, zedSettings } from '../activation';
import { target } from '../target';

export const zedTarget = target('zed', {
  description: 'Zed editor configuration',
  aliases: ['zd'],
  role: 'zed',
  packages: { casks: ['zed'] },
  activations: [
    zedSettings(
      asset('zed/settings.json'),
      OVERRIDES_PREFIX,
      home('.config/zed/settings.json'),
    ),
    link(asset('zed/keymap.json'), home('.config/zed/keymap.json')),
  ],
});
