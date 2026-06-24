import type { CAC } from 'cli-kit';
import { switchIdentity } from '../../app/identity';
import { CommandLineError } from '../../errors';
import { bunCommandRunner } from '../../host/command';
import { resolveHome } from '../../host/context';
import { aliasesOf, allScopes, resolveScope } from '../../identity/scope';

/** Canonical names and aliases, e.g. "personal/p, work/w", from the scope registry. */
function scopeHint(): string {
  return allScopes()
    .map((scope) => [scope, ...aliasesOf(scope)].join('/'))
    .join(', ');
}

export function registerSwitchCommand(program: CAC): void {
  const hint = scopeHint();
  program
    .command(
      `switch <${allScopes().join('|')}>`,
      `Switch the active Git identity (${hint}).`,
    )
    .alias('sw')
    .action(async (scope: string) => {
      const resolved = resolveScope(scope);
      if (!resolved) {
        throw new CommandLineError(
          `Unknown identity '${scope}'. Use: ${hint}.`,
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
