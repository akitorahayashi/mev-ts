import type { CAC } from 'cac';
import {
  loadIdentities,
  setIdentity,
  showIdentity,
  switchIdentity,
} from '../../app/identity';
import { CommandLineError } from '../../errors';
import { resolveScope } from '../../identity/scope';
import { bunCommandRunner } from '../../runtime/command';
import { resolveHome } from '../../runtime/context';
import { renderIdentities } from '../tty/identities';
import { withPrompter } from '../tty/prompt';

export function registerIdentityCommands(program: CAC): void {
  program
    .command('id <action>', 'Show or set Git identities (actions: show, set).')
    .action(async (action: string) => {
      const home = resolveHome();

      if (action === 'show') {
        const view = await showIdentity({ run: bunCommandRunner, home });
        process.stdout.write(`${renderIdentities(view)}\n`);
        return;
      }

      if (action === 'set') {
        await runSet(home);
        return;
      }

      throw new CommandLineError(
        `Unknown id action '${action}'. Use: show, set.`,
      );
    });

  program
    .command('sw <scope>', 'Switch Git identity (personal/p, work/w).')
    .action(async (scope: string) => {
      const resolved = resolveScope(scope);
      if (!resolved) {
        throw new CommandLineError(
          `Invalid identity '${scope}'. Valid: personal (p), work (w).`,
        );
      }

      const identity = await switchIdentity(
        { run: bunCommandRunner, home: resolveHome() },
        resolved,
      );
      process.stdout.write(
        `Switched to ${resolved} identity\n  Name:  ${identity.name}\n  Email: ${identity.email}\n`,
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
