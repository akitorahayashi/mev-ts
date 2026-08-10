import { configSelect, configSelectClear } from '../../../app/coder';
import { defineConfigCommand } from './namespace';

export const ConfigAgentsCommand = defineConfigCommand({
  name: 'agents',
  abbreviation: 'ag',
  description: 'Interactively select enabled AGENTS.md sections.',
  clearDescription:
    'Disable all currently cataloged entries; entries added by later updates start enabled.',
  runSelect: (home, warn, select) => configSelect('agents', home, warn, select),
  runClear: (home) => configSelectClear('agents', home),
});
