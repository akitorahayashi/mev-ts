import { realpath, rm } from 'node:fs/promises';
import { isAbsolute, join, relative, sep } from 'node:path';
import {
  CommandLineError,
  errorMessage,
  ProvisioningError,
} from '../../errors';
import { runCapture, runStep } from '../../git/run';
import { lstatIfPresent } from '../../host/absence';
import { type CommandRunner, formatCommandFailure } from '../../host/command';

export async function deleteSubmodule(
  run: CommandRunner,
  tokens: readonly string[],
  write: (msg: string) => void = () => {},
): Promise<void> {
  const submodulePath = parsePath(tokens);

  const resolved = await resolveSubmodule(run, submodulePath);
  const completed: string[] = [];
  write(`Deleting submodule ${submodulePath}...\n`);
  try {
    await runStep(run, [
      '-C',
      resolved.root,
      '--literal-pathspecs',
      'submodule',
      'deinit',
      '-f',
      '--',
      submodulePath,
    ]);
    completed.push('deinitialization');
    await runStep(run, [
      '-C',
      resolved.root,
      '--literal-pathspecs',
      'rm',
      '-f',
      '--',
      submodulePath,
    ]);
    completed.push('worktree/index removal');
    if (resolved.storage !== null) {
      await rm(resolved.storage, { recursive: true });
    }
  } catch (error) {
    throw new ProvisioningError(
      `Failed to delete submodule '${submodulePath}'; completed: ${completed.join(', ') || 'none'}. Remaining state requires inspection at '${resolved.root}' and '${resolved.storage ?? 'no module storage'}': ${errorMessage(error)}`,
    );
  }
  write(`Submodule ${submodulePath} deleted successfully.\n`);
}

function parsePath(tokens: readonly string[]): string {
  if (tokens.length === 0) {
    throw new CommandLineError('A submodule path is required.');
  }
  if (tokens.length > 1) {
    throw new CommandLineError('Only one submodule path is allowed.');
  }
  return validatePath(tokens[0] as string);
}

/**
 * A submodule path must be a relative path without traversal. Absolute paths or
 * any `.`/`..` segment are rejected so deletion cannot escape the repository.
 */
function validatePath(path: string): string {
  const segments = path.split(/[/\\]/);
  const isValid =
    path.length > 0 &&
    !path.startsWith('-') &&
    !/[\\*?[\]:\0\r\n]/.test(path) &&
    !isAbsolute(path) &&
    segments.every(
      (segment) => segment !== '' && segment !== '.' && segment !== '..',
    );

  if (!isValid) {
    throw new CommandLineError(
      `Invalid submodule path '${path}': expected one literal repository-relative path without traversal, options, or patterns.`,
    );
  }
  return path;
}

async function capture(
  run: CommandRunner,
  args: readonly string[],
): Promise<string> {
  const result = await runCapture(run, args);
  if (result.code !== 0) {
    throw new ProvisioningError(
      formatCommandFailure(`git ${args.join(' ')} failed`, result),
    );
  }
  return result.stdout;
}

async function resolveSubmodule(
  run: CommandRunner,
  submodulePath: string,
): Promise<{ root: string; storage: string | null }> {
  const root = (await capture(run, ['rev-parse', '--show-toplevel'])).replace(
    /\n$/,
    '',
  );
  const configuration = await capture(run, [
    '-C',
    root,
    'config',
    '--null',
    '--file',
    '.gitmodules',
    '--get-regexp',
    '^submodule\\..*\\.path$',
  ]);
  const modules = configuration
    .split('\0')
    .filter(Boolean)
    .map((entry) => {
      const delimiter = entry.indexOf('\n');
      const key = entry.slice(0, delimiter);
      return {
        name: key.slice('submodule.'.length, -'.path'.length),
        path: entry.slice(delimiter + 1),
      };
    });
  const matches = modules.filter((module) => module.path === submodulePath);
  const selected = matches[0];
  if (matches.length !== 1 || !selected) {
    throw new CommandLineError(
      `Expected one registered submodule at '${submodulePath}'.`,
    );
  }
  if (
    isAbsolute(selected.name) ||
    selected.name
      .split(/[/\\]/)
      .some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    throw new ProvisioningError(
      `Unsafe registered submodule name '${selected.name}'.`,
    );
  }
  if (
    modules.some(
      (module) =>
        module !== selected &&
        (module.name === selected.name ||
          module.name.startsWith(`${selected.name}/`)),
    )
  ) {
    throw new ProvisioningError(
      `Submodule '${selected.name}' shares storage with another registered module; deletion is unsafe.`,
    );
  }
  const index = await capture(run, [
    '-C',
    root,
    '--literal-pathspecs',
    'ls-files',
    '--stage',
    '-z',
    '--',
    submodulePath,
  ]);
  const entries = index.split('\0').filter(Boolean);
  if (
    entries.length !== 1 ||
    !/^160000 [0-9a-f]+ 0\t/.test(entries[0] ?? '') ||
    entries[0]?.slice(entries[0].indexOf('\t') + 1) !== submodulePath
  ) {
    throw new ProvisioningError(
      `'${submodulePath}' is not exactly one indexed submodule.`,
    );
  }
  const modulesRoot = (
    await capture(run, [
      '-C',
      root,
      'rev-parse',
      '--path-format=absolute',
      '--git-path',
      'modules',
    ])
  ).replace(/\n$/, '');
  const storage = (
    await capture(run, [
      '-C',
      root,
      'rev-parse',
      '--path-format=absolute',
      '--git-path',
      `modules/${selected.name}`,
    ])
  ).replace(/\n$/, '');
  const rel = relative(modulesRoot, storage);
  if (!rel || isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`)) {
    throw new ProvisioningError(
      `Unowned submodule storage '${storage}'; deletion is unsafe.`,
    );
  }
  const existing = await lstatIfPresent(storage);
  if (existing !== null) {
    if (
      (await lstatIfPresent(modulesRoot))?.isSymbolicLink() ||
      !existing.isDirectory() ||
      existing.isSymbolicLink() ||
      (await realpath(storage)) !== join(await realpath(modulesRoot), rel)
    ) {
      throw new ProvisioningError(
        `Unowned submodule storage '${storage}'; deletion is unsafe.`,
      );
    }
  }
  if ((await lstatIfPresent(join(root, submodulePath, '.git'))) !== null) {
    const actual = (
      await capture(run, [
        '-C',
        join(root, submodulePath),
        'rev-parse',
        '--absolute-git-dir',
      ])
    ).replace(/\n$/, '');
    if (
      existing === null ||
      (await realpath(actual)) !== (await realpath(storage))
    ) {
      throw new ProvisioningError(
        `Submodule '${submodulePath}' uses unexpected storage '${actual}'; deletion is unsafe.`,
      );
    }
  }
  return { root, storage: existing === null ? null : storage };
}
