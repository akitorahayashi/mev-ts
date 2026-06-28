import { Command, Option } from 'clipanion';
import { resolveProfile } from '../../provisioning/profile';
import { fullSetupTargets } from '../../provisioning/registry';
import { executeProvisioningRun } from './provisioning';

export class CreateCommand extends Command {
  static override paths = [['create'], ['cr']];
  static override usage = Command.Usage({
    description:
      'Provision a full environment for a hardware profile. [aliases: cr]',
  });

  profile = Option.String();
  overwrite = Option.Boolean('-o,--overwrite', false, {
    description: 'Replace unmanaged files when linking configs.',
  });

  async execute(): Promise<number> {
    const profile = resolveProfile(this.profile);
    const tags = fullSetupTargets().map((t) => t.tags[0]);

    return executeProvisioningRun({
      tags,
      overwrite: this.overwrite,
      intro: `mev: Creating ${profile} environment`,
      footer: (report) =>
        report.failed
          ? undefined
          : ['Optional', 'GUI applications: mev make br-c'],
    });
  }
}
