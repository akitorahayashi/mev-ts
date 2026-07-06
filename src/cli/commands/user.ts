import { Command } from 'clipanion';
import { loadIdentities, setIdentity, showIdentity } from '../../app/identity';
import { bunCommandRunner } from '../../host/command';
import { resolveHome } from '../../host/context';
import { renderIdentities } from '../tty/identities';
import { withPrompter } from '../tty/prompt';

export class UserCommand extends Command {
  static override paths = [['user'], ['us']];
  static override usage = Command.Usage({
    description:
      "Show stored Git identities, or 'set' to configure them. [aliases: us]",
  });

  async execute(): Promise<void> {
    const view = await showIdentity({
      run: bunCommandRunner,
      home: resolveHome(),
    });
    process.stdout.write(`${renderIdentities(view)}\n`);
  }
}

export class UserSetCommand extends Command {
  static override paths = [
    ['user', 'set'],
    ['us', 'set'],
  ];
  static override usage = Command.Usage({
    description: 'Configure the stored Git identities interactively.',
  });

  async execute(): Promise<void> {
    await runSet(resolveHome());
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
