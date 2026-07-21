import { embeddedAssets } from '../../assets/registry';
import { applyDefaultsTree } from '../activation';
import { target } from '../target';

export const systemTarget = target('system', {
  description: 'macOS system defaults (Dock, Finder, keyboard, trackpad, etc.)',
  aliases: ['sys'],
  role: 'system',
  activations: applyDefaultsTree(embeddedAssets, 'system/'),
});
