import { expect } from 'bun:test';
import {
  lstat,
  mkdir,
  readFile,
  rename,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import {
  bunCommandRunner,
  type CommandRunner,
} from '../../../src/host/command';
import { deleteSubmodule } from '../../../src/internal/git/submodule';
import { sandboxedTest } from '../../fixtures/temporary-directory';

const sandboxTest = sandboxedTest('submodule-');

// Real Git owns the persisted layout, including named modules and linked worktrees.
function runner(cwd: string): CommandRunner {
  return {
    run(command, args, options) {
      return bunCommandRunner.run(command, args, {
        ...options,
        cwd,
        stdout: 'pipe',
        stderr: 'pipe',
        env: {
          ...options?.env,
          GIT_CONFIG_GLOBAL: '/dev/null',
          GIT_CONFIG_NOSYSTEM: '1',
          GIT_AUTHOR_NAME: 'Test',
          GIT_AUTHOR_EMAIL: 'test@example.test',
          GIT_COMMITTER_NAME: 'Test',
          GIT_COMMITTER_EMAIL: 'test@example.test',
        },
      });
    },
  };
}

async function git(run: CommandRunner, ...args: string[]): Promise<string> {
  const result = await run.run('git', args);
  if (result.code !== 0)
    throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout.replace(/\n$/, '');
}

async function fixture(sandbox: string) {
  const origin = join(sandbox, 'origin');
  const root = join(sandbox, 'project');
  await mkdir(origin);
  await mkdir(root);
  const originRunner = runner(origin);
  await git(originRunner, 'init', '-q');
  await writeFile(join(origin, 'file'), 'module content');
  await git(originRunner, 'add', 'file');
  await git(originRunner, 'commit', '-qm', 'initial');
  const run = runner(root);
  await git(run, 'init', '-q');
  for (const [name, path] of [
    ['logical-name', 'vendor/dep'],
    ['other-name', 'vendor/other'],
  ] as const) {
    await git(
      run,
      '-c',
      'protocol.file.allow=always',
      'submodule',
      'add',
      '--name',
      name,
      origin,
      path,
    );
  }
  await git(run, 'commit', '-qm', 'modules');
  const storage = await git(
    runner(join(root, 'vendor/dep')),
    'rev-parse',
    '--absolute-git-dir',
  );
  const otherStorage = await git(
    runner(join(root, 'vendor/other')),
    'rev-parse',
    '--absolute-git-dir',
  );
  return { root, run, storage, otherStorage };
}

async function absent(path: string): Promise<void> {
  await expect(lstat(path)).rejects.toHaveProperty('code', 'ENOENT');
}

async function retainedOther(root: string, storage: string): Promise<void> {
  expect(await readFile(join(root, 'vendor/other/file'), 'utf8')).toBe(
    'module content',
  );
  expect((await lstat(storage)).isDirectory()).toBe(true);
  expect(
    await git(
      runner(root),
      'config',
      '--file',
      '.gitmodules',
      '--get',
      'submodule.other-name.path',
    ),
  ).toBe('vendor/other');
}

sandboxTest(
  'deletes the registered named module and its actual storage, leaving another module untouched',
  async (sandbox) => {
    const { root, run, storage, otherStorage } = await fixture(sandbox);
    await deleteSubmodule(run, ['vendor/dep']);
    await absent(join(root, 'vendor/dep'));
    await absent(storage);
    expect(await git(run, 'ls-files', '--', 'vendor/dep')).toBe('');
    expect(
      (
        await run.run('git', [
          'config',
          '--get-regexp',
          '^submodule.logical-name\\.',
        ])
      ).code,
    ).toBe(1);
    expect(
      (
        await run.run('git', [
          'config',
          '--file',
          '.gitmodules',
          '--get-regexp',
          '^submodule.logical-name\\.',
        ])
      ).code,
    ).toBe(1);
    await retainedOther(root, otherStorage);
  },
);

sandboxTest(
  'repository-relative selection works from a nested working directory',
  async (sandbox) => {
    const { root, storage, otherStorage } = await fixture(sandbox);
    await mkdir(join(root, 'nested'));
    await deleteSubmodule(runner(join(root, 'nested')), ['vendor/dep']);
    await absent(storage);
    await retainedOther(root, otherStorage);
  },
);

sandboxTest(
  'already-deinitialized module has no redundant config-section failure',
  async (sandbox) => {
    const { root, run, storage, otherStorage } = await fixture(sandbox);
    await git(run, 'submodule', 'deinit', '-f', '--', 'vendor/dep');
    await deleteSubmodule(run, ['vendor/dep']);
    await absent(storage);
    await retainedOther(root, otherStorage);
  },
);

sandboxTest(
  'a linked worktree resolves its own module storage',
  async (sandbox) => {
    const { root, run, storage, otherStorage } = await fixture(sandbox);
    const linked = join(sandbox, 'linked');
    await git(run, 'worktree', 'add', '-qb', 'linked', linked);
    const linkedRunner = runner(linked);
    await git(
      linkedRunner,
      '-c',
      'protocol.file.allow=always',
      'submodule',
      'update',
      '--init',
    );
    const linkedStorage = await git(
      runner(join(linked, 'vendor/dep')),
      'rev-parse',
      '--absolute-git-dir',
    );
    await deleteSubmodule(linkedRunner, ['vendor/dep']);
    await absent(linkedStorage);
    expect((await lstat(storage)).isDirectory()).toBe(true);
    await retainedOther(root, otherStorage);
  },
);

sandboxTest(
  'unregistered paths and pattern/option inputs cause no mutations',
  async (sandbox) => {
    const { root, run, storage, otherStorage } = await fixture(sandbox);
    const before = await git(run, 'status', '--porcelain');
    for (const input of [
      '-f',
      'vendor/*',
      'vendor/[do]*',
      ':(glob)vendor/**',
      'vendor/missing',
    ]) {
      await expect(deleteSubmodule(run, [input])).rejects.toThrow();
      expect(await git(run, 'status', '--porcelain')).toBe(before);
      expect((await lstat(storage)).isDirectory()).toBe(true);
      await retainedOther(root, otherStorage);
    }
  },
);

sandboxTest(
  'unexpected external module storage is refused before deinitialization',
  async (sandbox) => {
    const { root, run, storage, otherStorage } = await fixture(sandbox);
    const external = join(sandbox, 'external-storage');
    await rename(storage, external);
    await symlink(external, storage);
    await expect(deleteSubmodule(run, ['vendor/dep'])).rejects.toThrow(
      'deletion is unsafe',
    );
    expect(await readFile(join(root, 'vendor/dep/file'), 'utf8')).toBe(
      'module content',
    );
    expect((await lstat(external)).isDirectory()).toBe(true);
    await retainedOther(root, otherStorage);
  },
);

sandboxTest(
  'partial failures identify completed actions and preserved storage',
  async (sandbox) => {
    const { root, run, storage } = await fixture(sandbox);
    const failing: CommandRunner = {
      run(command, args, options) {
        if (args.includes('rm'))
          return Promise.resolve({
            code: 1,
            stdout: '',
            stderr: 'injected removal failure',
          });
        return run.run(command, args, options);
      },
    };
    await expect(deleteSubmodule(failing, ['vendor/dep'])).rejects.toThrow(
      'completed: deinitialization',
    );
    expect((await lstat(storage)).isDirectory()).toBe(true);
    expect(await git(run, 'ls-files', '--', 'vendor/dep')).toBe('vendor/dep');
    expect((await lstat(join(root, 'vendor/dep'))).isDirectory()).toBe(true);
  },
);
