import { type CAC, runCli } from 'cli-kit';
import packageMetadata from '../../package.json';
import { registerListCommand } from './commands/list';
import { registerMakeCommand } from './commands/make';
import { registerSwitchCommand } from './commands/switch';
import { registerUserCommand } from './commands/user';
import { runInternalCommandLine } from './internal';

export function runCommandLine(
  args: readonly string[] = Bun.argv.slice(2),
): Promise<number> {
  if (args[0] === 'internal') {
    return runInternalCommandLine(args.slice(1));
  }

  return runCli({
    bin: packageMetadata.name,
    version: packageMetadata.version,
    tagline: packageMetadata.description,
    register: (program: CAC) => {
      registerMakeCommand(program);
      registerListCommand(program);
      registerUserCommand(program);
      registerSwitchCommand(program);
    },
    argv: args,
  });
}
