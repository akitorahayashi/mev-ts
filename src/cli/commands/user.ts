import type { CAC } from 'cli-kit';
import { loadIdentities, setIdentity, showIdentity } from '../../app/identity';
import { CommandLineError } from '../../errors';
import { bunCommandRunner } from '../../runtime/command';
import { resolveHome } from '../../runtime/context';
import { renderIdentities } from '../tty/identities';
import { withPrompter } from '../tty/prompt';

export function registerUserCommand(program: CAC): void {
  program
    .command(
      'user [set]',
      "Show stored Git identities, or 'set' to configure them.",
    )
    .alias('us')
    .action(async (action: string | undefined) => {
      const home = resolveHome();

      if (action === undefined) {
        const view = await showIdentity({ run: bunCommandRunner, home });
        process.stdout.write(`${renderIdentities(view)}\n`);
        return;
      }

      if (action === 'set') {
        await runSet(home);
        return;
      }

      throw new CommandLineError(
        `Unknown argument '${action}'. Use: mev user (show) or mev user set.`,
      );
    });
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
