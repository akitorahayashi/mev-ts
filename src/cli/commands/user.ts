import { Command } from 'clipanion';
import { loadIdentities, setIdentity, showIdentity } from '../../app/identity';
import { bunCommandRunner } from '../../host/command';
import { resolveHome } from '../../host/context';
import { renderIdentities } from '../tty/identities';
import { withPrompter } from '../tty/prompt';
import { runReportingDomainErrors } from './domain-error';
import { writeNamespaceOverview } from './namespace-overview';

export class UserHelpCommand extends Command {
  static override paths = [['user'], ['us']];
  static override usage = Command.Usage({
    category: 'user',
    description: 'Show git identity subcommands. [aliases: us]',
  });

  async execute(): Promise<void> {
    const [canonical = []] = UserHelpCommand.paths;
    writeNamespaceOverview(this, 'user', canonical);
  }
}

export class UserShowCommand extends Command {
  static override paths = [
    ['user', 'show'],
    ['us', 'show'],
  ];
  static override usage = Command.Usage({
    category: 'user',
    description: 'Show stored Git identities. [aliases: us show]',
  });

  async execute() {
    return runReportingDomainErrors(this.context.stderr, async () => {
      const view = await showIdentity({
        run: bunCommandRunner,
        home: resolveHome(),
      });
      process.stdout.write(`${renderIdentities(view)}\n`);
    });
  }
}

export class UserSetCommand extends Command {
  static override paths = [
    ['user', 'set'],
    ['us', 'set'],
  ];
  static override usage = Command.Usage({
    category: 'user',
    description:
      'Configure the stored Git identities interactively. [aliases: us set]',
  });

  async execute() {
    return runReportingDomainErrors(this.context.stderr, () =>
      runSet(resolveHome()),
    );
  }
}

async function runSet(home: string): Promise<void> {
  const existing = await loadIdentities({ home });

  const inputs = await withPrompter(async (prompter) => {
    process.stdout.write(
      'Configure mev Git identities\n\nPersonal identity:\n',
    );
    const personal = {
      name: await prompter.ask('  Name', existing.personal?.name ?? ''),
      email: await prompter.ask('  Email', existing.personal?.email ?? ''),
    };
    process.stdout.write('\nWork identity:\n');
    const work = {
      name: await prompter.ask('  Name', existing.work?.name ?? ''),
      email: await prompter.ask('  Email', existing.work?.email ?? ''),
    };
    return { personal, work };
  });

  const { path } = await setIdentity({ home }, inputs);
  process.stdout.write(`\nIdentity configuration saved to ${path}\n`);
}
