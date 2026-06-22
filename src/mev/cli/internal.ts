import { CommandLineError } from '../errors';
import { buildDeployTasks, buildResetTasks } from '../internal/gh/labels';
import { deleteBranches } from '../internal/git/branches';
import { cloneRepositories } from '../internal/git/clone';
import { deleteSubmodule } from '../internal/git/submodule';
import { bunCommandRunner } from '../runtime/command';
import { runTasks } from './render/tasks';

const USAGE = `mev internal <command>

Commands:
  git clone <urls...> [-- <flags...>]            Clone repositories sequentially.
  git delete-branches <branches...> [-- <to>]    Delete local branches after updating the checkout branch.
  git delete-submodule <path>                    Delete a git submodule completely.
  gh labels deploy [--repo <owner/repo>]         Deploy the mev label catalog to a repository.
  gh labels reset [--repo <owner/repo>]          Delete all labels from a repository.
`;

export async function runInternalCommandLine(
  args: readonly string[],
): Promise<number> {
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    process.stdout.write(USAGE);
    return 0;
  }

  try {
    await dispatch(args);
    return 0;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    if (error instanceof CommandLineError) {
      process.stdout.write(USAGE);
    }
    return 1;
  }
}

async function dispatch(args: readonly string[]): Promise<void> {
  const path = `${args[0]} ${args[1] ?? ''}`.trim();

  switch (path) {
    case 'git clone':
      return cloneRepositories(bunCommandRunner, args.slice(2));
    case 'git delete-branches':
      return deleteBranches(bunCommandRunner, args.slice(2));
    case 'git delete-submodule':
      return deleteSubmodule(bunCommandRunner, args.slice(2));
    default:
      return dispatchGh(args, path);
  }
}

async function dispatchGh(
  args: readonly string[],
  path: string,
): Promise<void> {
  if (path !== 'gh labels') {
    throw new CommandLineError(`Unknown internal command '${args.join(' ')}'.`);
  }

  const action = args[2];
  if (action !== 'deploy' && action !== 'reset') {
    throw new CommandLineError(`Unknown internal command '${args.join(' ')}'.`);
  }

  const repo = extractRepo(args.slice(3));

  if (action === 'deploy') {
    const tasks = await buildDeployTasks(bunCommandRunner, repo);
    await runTasks(tasks, { concurrent: true });
    return;
  }

  const tasks = await buildResetTasks(bunCommandRunner, repo);
  await runTasks(tasks, { concurrent: true });
}

function extractRepo(tokens: readonly string[]): string | undefined {
  if (tokens.length === 0) {
    return undefined;
  }
  if (tokens[0] !== '--repo' && tokens[0] !== '-R') {
    throw new CommandLineError(`Unexpected argument '${tokens[0]}'.`);
  }
  const value = tokens[1];
  if (value === undefined || value.startsWith('-')) {
    throw new CommandLineError(
      'Option --repo requires a value: --repo <owner/repo>.',
    );
  }
  if (tokens.length > 2) {
    throw new CommandLineError(`Unexpected argument '${tokens[2]}'.`);
  }
  return value;
}
