import { Command } from 'clipanion';
import { createContext } from '../../host/context';
import { pruneObsoleteDeployState } from '../../provisioning/deploy-store';
import { allTargets, fullSetupTargets } from '../../provisioning/registry';
import { runMake } from '../../provisioning/run';
import type { Target } from '../../provisioning/target';
import { executeProvisioningRun } from '../provisioning-run';
import { withAliasHint } from './alias-hint';
import { runReportingDomainErrors } from './domain-error';

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
      const context = createContext();
      await pruneObsoleteDeployState(context, (text) =>
        this.context.stdout.write(text),
      );

      const selectors = fullSetupTargets().map((target) => target.name);

      return executeProvisioningRun({
        selectors,
        intro: 'mev: Creating environment',
        footer: (report) => (report.failed ? undefined : optionalFooter()),
        run: (request) => runMake(request, context),
        out: (text) => this.context.stdout.write(text),
      });
    });
  }
}
