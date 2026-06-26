import { applyDefaults, runCommand } from '../activation';
import { target } from '../target';

const DEFAULTS = ['behavior', 'build', 'editor', 'ui'];

export const xcodeTarget = target('xcode', {
  description: 'Xcode preferences via macOS defaults',
  aliases: ['xc'],
  role: 'editor/xcode',
  packages: { formulae: ['mint', 'xcbeautify', 'xcodes'] },
  activations: [
    runCommand({
      label: 'quit Xcode before writing defaults',
      steps: [
        {
          // pkill exits 1 when no process matched, which is not a failure;
          // any code above 1 is a real error.
          label: 'pkill Xcode',
          argv: () => ['bash', '-c', 'pkill Xcode; [ $? -le 1 ]'],
          changedWhen: 'never',
        },
      ],
    }),
    ...DEFAULTS.map((name) => applyDefaults(`editor/xcode/global/${name}.yml`)),
  ],
});
