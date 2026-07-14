import { configSelect, configSelectClear } from '../../../app/coder';
import { defineConfigCommand } from './command';

export const ConfigSkillsCommand = defineConfigCommand({
  paths: [
    ['config', 'skills'],
    ['config', 'sk'],
    ['cf', 'skills'],
    ['cf', 'sk'],
  ],
  description: 'Interactively select enabled skills.',
  clearDescription:
    'Disable all currently cataloged entries; entries added by later updates start enabled.',
  runSelect: (home, warn, select) => configSelect('skills', home, warn, select),
  runClear: (home) => configSelectClear('skills', home),
});
