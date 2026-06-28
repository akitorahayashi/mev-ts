import { Command, Option } from 'clipanion';
import { executeProvisioningRun } from './provisioning';

export class MakeCommand extends Command {
  static override paths = [['make'], ['mk']];
  static override usage = Command.Usage({
    description: 'Apply provisioning for one or more tags. [aliases: mk]',
  });

  tags = Option.Rest({ required: 1 });
  overwrite = Option.Boolean('-o,--overwrite', false, {
    description: 'Replace unmanaged files when linking configs.',
  });

  async execute(): Promise<number> {
    return executeProvisioningRun({
      tags: this.tags,
      overwrite: this.overwrite,
    });
  }
}
