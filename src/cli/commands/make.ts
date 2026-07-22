import { Command, Option } from 'clipanion';
import { executeProvisioningRun } from '../provisioning-run';
import { withAliasHint } from './alias-hint';
import { runReportingDomainErrors } from './domain-error';

export class MakeCommand extends Command {
  static override paths = [['make'], ['mk']];
  static override usage = Command.Usage({
    description: withAliasHint(
      'Apply provisioning for one or more targets.',
      MakeCommand.paths,
    ),
  });

  selectors = Option.Rest({ required: 1 });

  async execute() {
    return runReportingDomainErrors(this.context.stderr, () =>
      executeProvisioningRun({
        selectors: this.selectors,
        out: (text) => this.context.stdout.write(text),
      }),
    );
  }
}
