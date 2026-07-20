import { Command } from 'clipanion';
import { createContext } from '../../host/context';
import {
  deployStorePruneLines,
  pruneDeployStore,
} from '../../provisioning/deploy-store';
import { allTargets, fullSetupTargets } from '../../provisioning/registry';
import { runMake } from '../../provisioning/run';
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
      const context = createContext();
      const registeredTargets = allTargets();
      const cleanup = await pruneDeployStore(
        {
          roles: registeredTargets.map((target) => target.role),
          targets: registeredTargets.map((target) => target.name),
        },
        context,
      );
      const cleanupLines = deployStorePruneLines(cleanup);
      if (cleanupLines.length > 0) {
        this.context.stdout.write(
          `mev: Cleaned obsolete provisioning state\n${cleanupLines.join('\n')}\n`,
        );
      }

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
