import { target } from '../target';

// Marked `optional` so a full-environment `create` defers these GUI
// applications; install on demand with `mev make br-c`.
export const casksTarget = target('casks', {
  description: 'Baseline Homebrew casks',
  aliases: ['br-c'],
  role: 'casks',
  optional: true,
  activations: [],
});
