import { applyDefaults } from '../activation';
import { target } from '../target';

export const systemTarget = target('system', {
  description: 'macOS system defaults (Dock, Finder, keyboard, trackpad, etc.)',
  aliases: ['sys'],
  role: 'system',
  activations: [
    applyDefaults('system/desktop.yml'),
    applyDefaults('system/dock.yml'),
    applyDefaults('system/finder.yml'),
    applyDefaults('system/hot_corners.yml'),
    applyDefaults('system/keyboard.yml'),
    applyDefaults('system/mission_control.yml'),
    applyDefaults('system/mouse.yml'),
    applyDefaults('system/screenshots.yml'),
    applyDefaults('system/sound.yml'),
    applyDefaults('system/system_settings.yml'),
    applyDefaults('system/terminal.yml'),
    applyDefaults('system/trackpad.yml'),
    applyDefaults('system/ui_ux.yml'),
  ],
});
