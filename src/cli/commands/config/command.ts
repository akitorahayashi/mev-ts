import { Command, Option } from 'clipanion';
import type { SelectEntries } from '../../../app/config-selection';
import { resolveHome } from '../../../host/context';
import { toggle } from '../../tty/toggle';
import { runReportingDomainErrors } from '../domain-error';

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
 * non-canonical paths so it cannot drift from the actual routing, and the
 * stdout warn writer is applied uniformly here rather than per command.
 */
export function defineConfigCommand(spec: ConfigCommandSpec) {
  const aliases = spec.paths.slice(1).map((path) => path.join(' '));
  const description = aliases.length
    ? `${spec.description} [aliases: ${aliases.join(', ')}]`
    : spec.description;

  return class extends Command {
    static override paths = spec.paths;
    static override usage = Command.Usage({ category: 'config', description });

    clear = Option.Boolean('--clear', false, {
      description: spec.clearDescription,
    });

    async execute() {
      return runReportingDomainErrors(this.context.stderr, async () => {
        const home = resolveHome();
        if (this.clear) {
          await spec.runClear(home);
        } else {
          await spec.runSelect(home, (m) => process.stdout.write(m), toggle);
        }
      });
    }
  };
}
