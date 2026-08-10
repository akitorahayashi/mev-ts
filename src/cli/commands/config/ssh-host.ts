import { Command, Option } from 'clipanion';
import { configureSshHost } from '../../../app/ssh-host';
import { resolveHome } from '../../../host/context';
import { withAliasHint } from '../alias-hint';
import { runReportingDomainErrors } from '../domain-error';
import { CONFIG_CATEGORY, configSubcommandPaths } from './namespace';

export class ConfigSshHostCommand extends Command {
  static override paths = configSubcommandPaths('ssh-host', 'sh');

  static override usage = Command.Usage({
    category: CONFIG_CATEGORY,
    description: withAliasHint(
      'Configure the per-machine SSH host alias used for GitHub access.',
      ConfigSshHostCommand.paths,
    ),
  });

  sshHost = Option.String({ required: true });

  async execute() {
    return runReportingDomainErrors(this.context.stderr, async () => {
      const path = await configureSshHost(resolveHome(), this.sshHost);
      this.context.stdout.write(`GitHub SSH host saved to ${path}\n`);
    });
  }
}
