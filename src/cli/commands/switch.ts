import { Command, Option } from 'clipanion';
import { switchIdentity } from '../../app/identity';
import { CommandLineError } from '../../errors';
import { bunCommandRunner } from '../../host/command';
import { resolveHome } from '../../host/context';
import { aliasesOf, allScopes, resolveScope } from '../../identity/scope';

function scopeHint(): string {
  return allScopes()
    .map((scope) => [scope, ...aliasesOf(scope)].join('/'))
    .join(', ');
}

export class SwitchCommand extends Command {
  static override paths = [['switch'], ['sw']];
  static override usage = Command.Usage({
    description: `Switch the active Git identity (${scopeHint()}).`,
    details: `Available scopes: ${allScopes().join(', ')}.`,
  });

  scope = Option.String({ required: true });

  async execute(): Promise<void> {
    const hint = scopeHint();
    const resolved = resolveScope(this.scope);
    if (!resolved) {
      throw new CommandLineError(
        `Unknown identity '${this.scope}'. Use: ${hint}.`,
      );
    }

    const identity = await switchIdentity(
      { run: bunCommandRunner, home: resolveHome() },
      resolved,
    );
    process.stdout.write(
      `Switched to ${resolved} identity\n  Name:  ${identity.name}\n  Email: ${identity.email}\n`,
    );
  }
}
