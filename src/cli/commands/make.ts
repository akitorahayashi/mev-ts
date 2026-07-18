import { Command, Option } from 'clipanion';
import { withAliasHint } from './alias-hint';
import { runReportingDomainErrors } from './domain-error';
import { executeProvisioningRun } from './provisioning';

export class MakeCommand extends Command {
  static override paths = [['make'], ['mk']];
  static override usage = Command.Usage({
    description: withAliasHint(
      'Apply provisioning for one or more tags.',
      MakeCommand.paths,
    ),
  });

  tags = Option.Rest({ required: 1 });

  async execute() {
    return runReportingDomainErrors(this.context.stderr, () =>
      executeProvisioningRun({
        tags: this.tags,
        out: (text) => this.context.stdout.write(text),
      }),
    );
  }
}
