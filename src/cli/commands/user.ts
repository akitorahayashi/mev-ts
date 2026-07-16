import { Command } from 'clipanion';
import {
  type IdentityInput,
  loadIdentities,
  setIdentity,
  showIdentity,
} from '../../app/identity';
import { bunCommandRunner } from '../../host/command';
import { resolveHome } from '../../host/context';
import { allScopes, type IdentityScope } from '../../identity/scope';
import { renderIdentities } from '../tty/identities';
import { renderNamespaceOverview } from '../tty/namespace-overview';
import { withPrompter } from '../tty/prompt';
import { resolveIsTTY } from '../tty/style';
import { withAliasHint } from './alias-hint';
import { runReportingDomainErrors } from './domain-error';

export class UserHelpCommand extends Command {
  static override paths = [['user'], ['us']];
  static override usage = Command.Usage({
    category: 'user',
    description: withAliasHint(
      'Show git identity subcommands.',
      UserHelpCommand.paths,
    ),
  });

  async execute(): Promise<void> {
    const [canonical = []] = UserHelpCommand.paths;
    this.context.stdout.write(
      renderNamespaceOverview({
        binaryName: this.cli.binaryName,
        invokedPath: this.path,
        canonicalPath: canonical,
        category: 'user',
        definitions: this.cli.definitions(),
      }),
    );
  }
}

export class UserShowCommand extends Command {
  static override paths = [
    ['user', 'show'],
    ['us', 'show'],
  ];
  static override usage = Command.Usage({
    category: 'user',
    description: withAliasHint(
      'Show stored Git identities.',
      UserShowCommand.paths,
    ),
  });

  async execute() {
    return runReportingDomainErrors(this.context.stderr, async () => {
      const view = await showIdentity({
        run: bunCommandRunner,
        home: resolveHome(),
      });
      this.context.stdout.write(`${renderIdentities(view, resolveIsTTY())}\n`);
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
    description: withAliasHint(
      'Configure the stored Git identities interactively.',
      UserSetCommand.paths,
    ),
  });

  async execute() {
    return runReportingDomainErrors(this.context.stderr, () =>
      runSet(resolveHome(), (message) => this.context.stdout.write(message)),
    );
  }
}

async function runSet(
  home: string,
  write: (message: string) => void,
): Promise<void> {
  const existing = await loadIdentities({ home });

  const inputs = await withPrompter(async (prompter) => {
    write('Configure mev Git identities\n');
    const entries: [IdentityScope, IdentityInput][] = [];
    for (const scope of allScopes()) {
      write(`\n${capitalize(scope)} identity:\n`);
      entries.push([
        scope,
        {
          name: await prompter.ask('  Name', existing[scope]?.name ?? ''),
          email: await prompter.ask('  Email', existing[scope]?.email ?? ''),
        },
      ]);
    }
    return Object.fromEntries(entries) as Record<IdentityScope, IdentityInput>;
  });

  const { path } = await setIdentity({ home }, inputs);
  write(`\nIdentity configuration saved to ${path}\n`);
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
