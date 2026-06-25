import { asset } from '../../assets/ref';
import { home } from '../../host/path';
import { link } from '../activation';
import { target } from '../target';

export const zedTarget = target('zed', {
  description: 'Zed editor configuration',
  aliases: ['zd'],
  role: 'editor/zed',
  activations: [
    link(
      asset('editor/zed/global/settings.json'),
      home('.config/zed/settings.json'),
    ),
    link(
      asset('editor/zed/global/keymap.json'),
      home('.config/zed/keymap.json'),
    ),
  ],
});
