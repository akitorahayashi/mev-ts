import { asset } from '../../assets/ref';
import { home } from '../../host/path';
import { link, zedSettings } from '../activation';
import { target } from '../target';
import { OVERRIDES_PREFIX } from '../zed/paths';

export const zedTarget = target('zed', {
  description: 'Zed editor configuration',
  aliases: ['zd'],
  role: 'editor/zed',
  packages: { casks: ['zed'] },
  activations: [
    zedSettings(
      asset('editor/zed/global/settings.json'),
      OVERRIDES_PREFIX,
      home('.config/zed/settings.json'),
    ),
    link(
      asset('editor/zed/global/keymap.json'),
      home('.config/zed/keymap.json'),
    ),
  ],
});
