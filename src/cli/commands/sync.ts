import { Command } from 'clipanion';
import { createContext } from '../../host/context';
import { fullSetupTargets } from '../../provisioning/registry';
import { runMake } from '../../provisioning/run';
import { scanTargets } from '../../provisioning/scan';
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
      const scans = await scanTargets(fullSetupTargets(), context);
      const tags = scans
        .filter((scan) => scan.reasons.length > 0)
        .map((scan) => scan.target.tags[0]);

      if (tags.length === 0) {
        this.context.stdout.write('mev: environment is synchronized\n');
        return 0;
      }

      return executeProvisioningRun({
        tags,
        intro: 'mev: Syncing environment',
        run: (request) => runMake(request, context),
        out: (text) => this.context.stdout.write(text),
      });
    });
  }
}
