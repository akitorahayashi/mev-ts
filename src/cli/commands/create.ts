import { Command, Option } from 'clipanion';
import { resolveProfile } from '../../provisioning/profile';
import { allTargets, fullSetupTargets } from '../../provisioning/registry';
import type { Target } from '../../provisioning/target';
import { withAliasHint } from './alias-hint';
import { runReportingDomainErrors } from './domain-error';
import { executeProvisioningRun } from './provisioning';

function optionalTargetLine(target: Target): string {
  return `${target.description}: mev make ${target.aliases[0] ?? target.tags[0]}`;
}

function optionalFooter(): readonly string[] | undefined {
  const lines = allTargets()
    .filter((target) => target.optional)
    .map(optionalTargetLine);
  return lines.length > 0 ? ['Optional', ...lines] : undefined;
}

export class CreateCommand extends Command {
  static override paths = [['create'], ['cr']];
  static override usage = Command.Usage({
    description: withAliasHint(
      'Provision a full environment for a hardware profile.',
      CreateCommand.paths,
    ),
  });

  profile = Option.String();

  async execute() {
    return runReportingDomainErrors(this.context.stderr, async () => {
      const profile = resolveProfile(this.profile);
      const tags = fullSetupTargets().map((t) => t.tags[0]);

      return executeProvisioningRun({
        tags,
        intro: `mev: Creating ${profile} environment`,
        footer: (report) => (report.failed ? undefined : optionalFooter()),
        out: (text) => this.context.stdout.write(text),
      });
    });
  }
}
