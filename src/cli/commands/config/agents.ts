import { Command, Option } from 'clipanion';
import { configSelect, configSelectClear } from '../../../app/coder';
import { resolveHome } from '../../../host/context';
import { toggle } from '../../tty/toggle';
import { runReportingDomainErrors } from '../domain-error';

export class ConfigAgentsCommand extends Command {
  static override paths = [
    ['config', 'agents'],
    ['config', 'ag'],
    ['cf', 'agents'],
    ['cf', 'ag'],
  ];
  static override usage = Command.Usage({
    category: 'config',
    description:
      'Interactively select enabled AGENTS.md sections. [aliases: ag, cf ag]',
  });

  clear = Option.Boolean('--clear', false, {
    description: 'Disable all entries.',
  });

  async execute() {
    return runReportingDomainErrors(this.context.stderr, async () => {
      const home = resolveHome();
      if (this.clear) {
        await configSelectClear('agents', home);
      } else {
        await configSelect(
          'agents',
          home,
          (m) => process.stdout.write(m),
          toggle,
        );
      }
    });
  }
}
