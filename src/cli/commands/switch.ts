import { Command, Option } from 'clipanion';
import {
  type CurrentIdentity,
  pinIdentity,
  switchIdentity,
  unpinIdentity,
} from '../../app/identity';
import { CommandLineError } from '../../errors';
import { liveCommandDeps } from '../../host/context';
import {
  aliasesOf,
  allScopes,
  type IdentityScope,
  resolveScope,
} from '../../identity/scope';
import type { Identity } from '../../identity/store';
import { withAliasHint } from './alias-hint';
import { runReportingDomainErrors } from './domain-error';

function scopeHint(): string {
  return allScopes()
    .map((scope) => [scope, ...aliasesOf(scope)].join('/'))
    .join(', ');
}

export class SwitchCommand extends Command {
  static override paths = [['switch'], ['sw']];
  static override usage = Command.Usage({
    description: withAliasHint(
      `Switch the active Git identity (${scopeHint()}).`,
      SwitchCommand.paths,
    ),
    details: `Available scopes: ${allScopes().join(', ')}. Without flags the identity is written to the global overlay; --write pins it to the current repository instead, and --unset removes that pin.`,
  });

  scope = Option.String({ required: false });
  write = Option.Boolean('-w,--write', false, {
    description: "Pin the identity to the current repository's .git/config",
  });
  unset = Option.Boolean('-u,--unset', false, {
    description:
      'Remove the repository pin so the repository follows the global identity',
  });

  async execute() {
    return runReportingDomainErrors(this.context.stderr, async () => {
      if (this.write && this.unset) {
        throw new CommandLineError('--write and --unset cannot be combined.');
      }
      if (this.unset) {
        if (this.scope !== undefined) {
          throw new CommandLineError(
            '--unset takes no scope; it removes the repository pin.',
          );
        }
        await this.runUnset();
        return;
      }

      const hint = scopeHint();
      if (this.scope === undefined) {
        throw new CommandLineError(`Missing identity scope. Use: ${hint}.`);
      }
      const resolved = resolveScope(this.scope);
      if (!resolved) {
        throw new CommandLineError(
          `Unknown identity '${this.scope}'. Use: ${hint}.`,
        );
      }

      if (this.write) {
        await this.runPin(resolved);
        return;
      }
      await this.runGlobalSwitch(resolved);
    });
  }

  private async runGlobalSwitch(scope: IdentityScope): Promise<void> {
    const result = await switchIdentity(liveCommandDeps(), scope);
    this.context.stdout.write(
      `Switched to ${scope} identity\n${renderIdentityLines(result.identity)}`,
    );
    if (result.locallyPinned) {
      this.context.stderr.write(
        "Warning: this repository is pinned locally (.git/config) and will not reflect this change. Run 'mev sw -u' here to remove the pin.\n",
      );
    }
  }

  private async runPin(scope: IdentityScope): Promise<void> {
    const identity = await pinIdentity(liveCommandDeps(), scope);
    this.context.stdout.write(
      `Pinned this repository to ${scope} identity\n${renderIdentityLines(identity)}`,
    );
  }

  private async runUnset(): Promise<void> {
    const result = await unpinIdentity(liveCommandDeps());
    const lead =
      result.kind === 'unpinned'
        ? 'Removed repository pin.'
        : 'Repository is not pinned; already following the global identity.';
    this.context.stdout.write(
      `${lead}\n${renderEffective(result.effective)}\n`,
    );
  }
}

function renderIdentityLines(identity: Identity): string {
  return `  Name:  ${identity.name}\n  Email: ${identity.email}\n`;
}

function renderEffective(current: CurrentIdentity): string {
  if (current.kind === 'unset') return 'Effective identity: not set';
  const who = `${current.identity.name} <${current.identity.email}>`;
  const label = current.kind === 'matched' ? current.scope : 'unmanaged';
  return `Effective identity: ${who} (${label})`;
}
