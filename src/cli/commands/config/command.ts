import { Command, Option } from 'clipanion';
import type { SelectEntries } from '../../../app/config-selection';
import { resolveHome } from '../../../host/context';
import { toggle } from '../../tty/toggle';
import { withAliasHint } from '../alias-hint';
import { runReportingDomainErrors } from '../domain-error';

/**
 * Usage category shared by every `config` subcommand and the config namespace
 * overview, so the overview's category filter cannot drift from the value the
 * subcommands register under.
 */
export const CONFIG_CATEGORY = 'config';

/** One config toggle surface: its routing, help text, and the two operations. */
export interface ConfigCommandSpec {
  readonly paths: string[][];
  readonly description: string;
  readonly clearDescription: string;
  readonly runSelect: (
    home: string,
    warn: (message: string) => void,
    select: SelectEntries,
  ) => Promise<void>;
  readonly runClear: (home: string) => Promise<void>;
}

/**
 * Build a config toggle command from a spec. The alias hint is derived from the
 * non-canonical paths so it cannot drift from the actual routing, and the warn
 * writer routes to stderr (diagnostics, matching the internal-command wiring)
 * uniformly here rather than per command.
 */
export function defineConfigCommand(spec: ConfigCommandSpec) {
  const description = withAliasHint(spec.description, spec.paths);

  return class extends Command {
    static override paths = spec.paths;
    static override usage = Command.Usage({
      category: CONFIG_CATEGORY,
      description,
    });

    clear = Option.Boolean('--clear', false, {
      description: spec.clearDescription,
    });

    async execute() {
      return runReportingDomainErrors(this.context.stderr, async () => {
        const home = resolveHome();
        if (this.clear) {
          await spec.runClear(home);
        } else {
          await spec.runSelect(
            home,
            (m) => this.context.stderr.write(m),
            toggle,
          );
        }
      });
    }
  };
}
