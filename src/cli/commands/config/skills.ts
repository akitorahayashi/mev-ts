import { Command, Option } from 'clipanion';
import { configSelect, configSelectClear } from '../../../app/coder';
import { resolveHome } from '../../../host/context';
import { toggle } from '../../tty/toggle';
import { runReportingDomainErrors } from '../domain-error';

export class ConfigSkillsCommand extends Command {
  static override paths = [
    ['config', 'skills'],
    ['config', 'sk'],
    ['cf', 'skills'],
    ['cf', 'sk'],
  ];
  static override usage = Command.Usage({
    category: 'config',
    description: 'Interactively select enabled skills. [aliases: sk, cf sk]',
  });

  clear = Option.Boolean('--clear', false, {
    description: 'Disable all entries.',
  });

  async execute() {
    return runReportingDomainErrors(this.context.stderr, async () => {
      const home = resolveHome();
      if (this.clear) {
        await configSelectClear('skills', home);
      } else {
        await configSelect(
          'skills',
          home,
          (m) => process.stdout.write(m),
          toggle,
        );
      }
    });
  }
}
