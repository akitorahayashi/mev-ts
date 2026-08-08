import { Command, Option } from 'clipanion';
import { writePluginSshHost } from '../../../agent-plugin/source';
import { resolveHome } from '../../../host/context';
import { withAliasHint } from '../alias-hint';
import { runReportingDomainErrors } from '../domain-error';
import { CONFIG_CATEGORY } from './command';

export class ConfigPluginHostCommand extends Command {
  static override paths = [
    ['config', 'plugin-host'],
    ['config', 'ph'],
    ['cf', 'plugin-host'],
    ['cf', 'ph'],
  ];

  static override usage = Command.Usage({
    category: CONFIG_CATEGORY,
    description: withAliasHint(
      'Configure the per-machine SSH host used for agent plugin installation.',
      ConfigPluginHostCommand.paths,
    ),
  });

  sshHost = Option.String({ required: true });

  async execute() {
    return runReportingDomainErrors(this.context.stderr, async () => {
      const path = await writePluginSshHost(resolveHome(), this.sshHost);
      this.context.stdout.write(`Agent plugin SSH host saved to ${path}\n`);
    });
  }
}
