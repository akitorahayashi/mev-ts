import { mevPath } from '../../host/path';
import { brewPrefixCapture, runCommand } from '../activation';
import { target } from '../target';

export const sweetpadTarget = target('sweetpad', {
  description: 'SweetPad CLI for Xcode projects and its zsh completions',
  aliases: ['sp'],
  role: 'sweetpad',
  activations: [
    runCommand({
      label: 'SweetPad zsh completions',
      steps: [
        brewPrefixCapture(),
        {
          label: 'sweetpad completions zsh',
          // SweetPad can also be installed through mise; the completions come
          // from the Homebrew binary this target installs, not whichever is first
          // on PATH.
          argv: [
            { concat: [{ ref: 'brewPrefix' }, '/bin/sweetpad'] },
            'completions',
            'zsh',
          ],
          stdoutTo: mevPath('completions', '_sweetpad'),
        },
      ],
    }),
  ],
});
