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

export function registerUserCommand(program: CAC): void {
  program
    .command('user [scope]', 'Manage Git identities (personal/p, work/w, set).')
    .alias('us')
    .action(async (scope: string | undefined) => {
      const home = resolveHome();

      if (scope === undefined) {
        const view = await showIdentity({ run: bunCommandRunner, home });
        process.stdout.write(`${renderIdentities(view)}\n`);
        return;
      }

      if (scope === 'set') {
        await runSet(home);
        return;
      }

      const resolved = resolveScope(scope);
      if (resolved) {
        const identity = await switchIdentity(
          { run: bunCommandRunner, home },
          resolved,
        );
        process.stdout.write(
          `Switched to ${resolved} identity\n  Name:  ${identity.name}\n  Email: ${identity.email}\n`,
        );
        return;
      }

      throw new CommandLineError(
        `Unknown argument '${scope}'. Use: personal (p), work (w), set.`,
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
