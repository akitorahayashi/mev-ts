import { applyDefaults } from '../activation';
import { target } from '../target';

const DEFAULTS = ['behavior', 'build', 'editor', 'ui'];

export const xcodeTarget = target('xcode', {
  description: 'Xcode preferences via macOS defaults',
  aliases: ['xc'],
  role: 'editor/xcode',
  packages: { formulae: ['mint', 'xcbeautify', 'xcodes'] },
  activations: DEFAULTS.map((name) =>
    applyDefaults(`editor/xcode/global/${name}.yml`),
  ),
});
