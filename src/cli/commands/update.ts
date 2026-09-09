import { Command, Option } from 'clipanion';
import packageMetadata from '../../../package.json';
import {
  type MevUpdateOutcome,
  resolveInstalledMevPath,
  runUpdatedSync,
  updateMev,
} from '../../app/update';
import { createContext } from '../../host/context';
import { runReportingDomainErrors } from './domain-error';

function reportOutcome(command: UpdateCommand, outcome: MevUpdateOutcome) {
  switch (outcome.kind) {
    case 'updated':
      command.context.stdout.write(
        `Updated mev ${outcome.previousVersion} -> ${outcome.version}.\n`,
      );
      break;
    case 'reinstalled':
      command.context.stdout.write(
        `Reinstalled mev ${outcome.version} from its published release.\n`,
      );
      break;
    case 'current':
      command.context.stdout.write(`mev ${outcome.version} is up to date.\n`);
      break;
    case 'ahead':
      command.context.stderr.write(
        `Warning: installed mev ${outcome.version} is newer than latest release ${outcome.latestVersion}; keeping it.\n`,
      );
  }
  if (outcome.cleanupWarning) {
    command.context.stderr.write(`Warning: ${outcome.cleanupWarning}\n`);
  }
}

export class UpdateCommand extends Command {
  static override paths = [['update']];
  static override usage = Command.Usage({
    description: 'Update mev from its latest release, then synchronize.',
  });

  upgrade = Option.Boolean('-u,--upgrade', false, {
    description:
      'Also upgrade Homebrew packages and installed latest-assumed tools in stale targets',
  });

  async execute() {
    return runReportingDomainErrors(this.context.stderr, async () => {
      const context = createContext();
      const executablePath = await resolveInstalledMevPath();
      const outcome = await updateMev({
        currentVersion: packageMetadata.version,
        executablePath,
        context,
      });
      reportOutcome(this, outcome);
      return runUpdatedSync(
        context.commands,
        outcome.executablePath,
        this.upgrade,
      );
    });
  }
}
