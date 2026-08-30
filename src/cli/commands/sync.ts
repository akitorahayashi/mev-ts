import { Command, Option } from 'clipanion';
import { runMake } from '../../provisioning/run';
import { isScanError, scanTargets } from '../../provisioning/scan';
import { executeProvisioningRun } from '../provisioning-run';
import { withAliasHint } from './alias-hint';
import { runReportingDomainErrors } from './domain-error';
import { prepareFullSetup } from './full-setup';

export class SyncCommand extends Command {
  static override paths = [['sync'], ['s']];
  static override usage = Command.Usage({
    description: withAliasHint(
      'Apply changed full-environment targets.',
      SyncCommand.paths,
    ),
  });

  // Upgrade mode does not widen selection: it affects packages and
  // latest-assumed tools only in targets already selected as stale, so a
  // synchronized environment remains a fast no-op without network access.
  upgrade = Option.Boolean('-u,--upgrade', false, {
    description:
      'Also upgrade Homebrew packages and installed latest-assumed tools in stale targets',
  });

  async execute() {
    return runReportingDomainErrors(this.context.stderr, async () => {
      const { context, targets } = await prepareFullSetup((text) =>
        this.context.stdout.write(text),
      );

      const scans = await scanTargets(targets, context);
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
        upgrade: this.upgrade,
        intro: 'mev: Syncing environment',
        run: (request) => runMake(request, context),
        stream: this.context.stdout,
      });
      return code === 0 && scanFailed ? 1 : code;
    });
  }
}
