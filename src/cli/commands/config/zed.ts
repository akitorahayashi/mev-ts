import {
  configSelectZedOverrides,
  configSelectZedOverridesClear,
} from '../../../app/zed';
import { defineConfigCommand } from './command';

export const ConfigZedCommand = defineConfigCommand({
  paths: [
    ['config', 'zed'],
    ['config', 'zd'],
    ['cf', 'zed'],
    ['cf', 'zd'],
  ],
  description: 'Interactively select enabled Zed setting overrides.',
  clearDescription: 'Disable all entries.',
  runSelect: (home, warn, select) =>
    configSelectZedOverrides(home, warn, select),
  runClear: (home) => configSelectZedOverridesClear(home),
});
