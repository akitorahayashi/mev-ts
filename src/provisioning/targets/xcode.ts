import { embeddedAssets } from '../../assets/registry';
import { applyDefaultsTree } from '../activation';
import { target } from '../target';

export const xcodeTarget = target('xcode', {
  description: 'Xcode preferences via macOS defaults',
  aliases: ['xc'],
  role: 'xcode',
  packages: { formulae: ['mint', 'xcbeautify', 'xcodes'] },
  activations: applyDefaultsTree(embeddedAssets, 'xcode/'),
});
