import { applyDefaults, target } from '../target';

export const systemTarget = target('system', {
  description: 'macOS system defaults (Dock, Finder, keyboard, trackpad, etc.)',
  aliases: ['sys'],
  role: 'system',
  activations: [applyDefaults('system/global/')],
});
