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
  overwrite = Option.Boolean('-o,--overwrite', false, {
    description: 'Replace unmanaged files when linking configs.',
  });

  async execute() {
    return runReportingDomainErrors(this.context.stderr, () =>
      executeProvisioningRun({
        tags: this.tags,
        overwrite: this.overwrite,
        out: (text) => this.context.stdout.write(text),
      }),
    );
  }
}
