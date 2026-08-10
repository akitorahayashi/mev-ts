import {
  configSelectZedOverrides,
  configSelectZedOverridesClear,
} from '../../../app/zed';
import { defineConfigCommand } from './namespace';

export const ConfigZedCommand = defineConfigCommand({
  name: 'zed',
  abbreviation: 'zd',
  description: 'Interactively select enabled Zed setting overrides.',
  clearDescription: 'Disable all entries.',
  runSelect: (home, warn, select) =>
    configSelectZedOverrides(home, warn, select),
  runClear: (home) => configSelectZedOverridesClear(home),
});
