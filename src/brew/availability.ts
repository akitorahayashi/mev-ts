import { ProvisioningError } from '../errors';
import { formatCommandFailure } from '../host/command';
import type { Context } from '../host/context';

export async function assertBrewAvailable(
  context: Pick<Context, 'commands'>,
): Promise<void> {
  const result = await context.commands.run('brew', ['--version']);
  if (result.code === 0) return;
  if (result.code === 127) {
    throw new ProvisioningError(
      "Homebrew (brew) could not be executed from PATH. Install Homebrew using https://brew.sh if it is missing. Follow the Homebrew installer's Next steps to configure your shell, then open a new terminal or run the recommended shellenv command in this terminal. Verify with brew --version and retry.",
    );
  }
  throw new ProvisioningError(
    formatCommandFailure('Homebrew prerequisite check failed', result),
  );
}
