import { Command } from 'clipanion';
import { allTargets, fullSetupTargets } from '../../provisioning/registry';
import type { Target } from '../../provisioning/target';
import { withAliasHint } from './alias-hint';
import { runReportingDomainErrors } from './domain-error';
import { executeProvisioningRun } from './provisioning';

function optionalTargetLine(target: Target): string {
  return `${target.description}: mev make ${target.aliases[0] ?? target.name}`;
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
      'Provision the full environment.',
      CreateCommand.paths,
    ),
  });

  async execute() {
    return runReportingDomainErrors(this.context.stderr, async () => {
      const selectors = fullSetupTargets().map((target) => target.name);

      return executeProvisioningRun({
        selectors,
        intro: 'mev: Creating environment',
        footer: (report) => (report.failed ? undefined : optionalFooter()),
        out: (text) => this.context.stdout.write(text),
      });
    });
  }
}
