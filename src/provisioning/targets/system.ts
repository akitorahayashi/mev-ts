import { applyDefaults } from '../activation';
import { target } from '../target';

export const systemTarget = target('system', {
  description: 'macOS system defaults (Dock, Finder, keyboard, trackpad, etc.)',
  aliases: ['sys'],
  role: 'system',
  activations: [
    applyDefaults('system/global/desktop.yml'),
    applyDefaults('system/global/dock.yml'),
    applyDefaults('system/global/finder.yml'),
    applyDefaults('system/global/hot_corners.yml'),
    applyDefaults('system/global/keyboard.yml'),
    applyDefaults('system/global/mission_control.yml'),
    applyDefaults('system/global/mouse.yml'),
    applyDefaults('system/global/screenshots.yml'),
    applyDefaults('system/global/sound.yml'),
    applyDefaults('system/global/system_settings.yml'),
    applyDefaults('system/global/terminal.yml'),
    applyDefaults('system/global/trackpad.yml'),
    applyDefaults('system/global/ui_ux.yml'),
  ],
});
