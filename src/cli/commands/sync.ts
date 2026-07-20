import { Command } from 'clipanion';
import { createContext } from '../../host/context';
import {
  deployStorePruneLines,
  pruneDeployStore,
} from '../../provisioning/deploy-store';
import { allTargets, fullSetupTargets } from '../../provisioning/registry';
import { runMake } from '../../provisioning/run';
import { isScanError, scanTargets } from '../../provisioning/scan';
import { withAliasHint } from './alias-hint';
import { runReportingDomainErrors } from './domain-error';
import { executeProvisioningRun } from './provisioning';

export class SyncCommand extends Command {
  static override paths = [['sync'], ['s']];
  static override usage = Command.Usage({
    description: withAliasHint(
      'Apply changed full-environment targets.',
      SyncCommand.paths,
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

      const scans = await scanTargets(fullSetupTargets(), context);
      let scanFailed = false;
      for (const scan of scans) {
        if (isScanError(scan)) {
          scanFailed = true;
          this.context.stderr.write(
            `mev: could not scan ${scan.target.name}: ${scan.error}\n`,
          );
        }
      }
      const selectors = scans
        .filter((scan) => !isScanError(scan) && scan.reasons.length > 0)
        .map((scan) => scan.target.name);

      if (selectors.length === 0) {
        // A scan error means at least one target's staleness is unknown, so the
        // environment cannot be reported as synchronized.
        if (scanFailed) return 1;
        this.context.stdout.write('mev: environment is synchronized\n');
        return 0;
      }

      const code = await executeProvisioningRun({
        selectors,
        intro: 'mev: Syncing environment',
        run: (request) => runMake(request, context),
        out: (text) => this.context.stdout.write(text),
      });
      return code === 0 && scanFailed ? 1 : code;
    });
  }
}
