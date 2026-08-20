import { expect, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  pinIdentity,
  setIdentity,
  showIdentity,
  switchIdentity,
  unpinIdentity,
} from '../../src/app/identity';
import { AppError } from '../../src/errors';
import {
  bunCommandRunner,
  type CommandResult,
  type CommandRunner,
} from '../../src/host/command';
import {
  identityFilePath,
  makeIdentity,
  readState,
  saveState,
} from '../../src/identity/store';
import { withTemporaryDirectory } from '../fixtures/temporary-directory';

/**
 * Allocates fresh homes inside one per-test sandbox. The allocator is a
 * per-test closure rather than module-level mutable state, so nothing carries
 * between tests and their order never matters.
 */
type HomeAllocator = () => string;

function sandboxTest(
  name: string,
  body: (tempHome: HomeAllocator) => Promise<void>,
): void {
  test(name, async () => {
    await withTemporaryDirectory(
      async (dir) => {
        let counter = 0;
        await body(() => {
          counter += 1;
          const home = join(dir, `identity-app-${counter}`);
          mkdirSync(home);
          return home;
        });
      },
      { prefix: 'identity-app-' },
    );
  });
}

interface GitFakeState {
  readonly globals?: Record<string, string>;
  readonly locals?: Record<string, string>;
  readonly inRepo?: boolean;
}

/**
 * Scripts exactly the git argv shapes the identity use cases may issue and
 * throws on anything else, so a new call path cannot pass on an accidental
 * success. `--local` calls outside a repo answer with git's real exit 128 so
 * a missing repo-detection gate surfaces as a failure.
 */
function gitRunner(state: GitFakeState): {
  run: CommandRunner;
  writes: { path: string; key: string; value: string }[];
  localWrites: { cwd: string; key: string; value: string }[];
} {
  const globals = state.globals ?? {};
  const locals = { ...(state.locals ?? {}) };
  const inRepo = state.inRepo ?? false;
  const writes: { path: string; key: string; value: string }[] = [];
  const localWrites: { cwd: string; key: string; value: string }[] = [];
  const notARepo: CommandResult = {
    code: 128,
    stdout: '',
    stderr:
      'fatal: not a git repository (or any of the parent directories): .git\n',
  };
  const run: CommandRunner = {
    async run(_command, args): Promise<CommandResult> {
      const rest = [...args];
      if (
        rest[0] === '-C' &&
        rest[2] === 'rev-parse' &&
        rest[3] === '--git-dir'
      ) {
        return inRepo ? { code: 0, stdout: '.git\n', stderr: '' } : notARepo;
      }
      if (rest[0] === '-C' && rest[2] === 'config' && rest[3] === '--local') {
        if (!inRepo) return notARepo;
        const cwd = rest[1] ?? '';
        if (rest[4] === '--get') {
          const value = locals[rest[5] ?? ''];
          return value === undefined
            ? { code: 1, stdout: '', stderr: '' }
            : { code: 0, stdout: `${value}\n`, stderr: '' };
        }
        if (rest[4] === '--unset-all') {
          const key = rest[5] ?? '';
          if (locals[key] === undefined)
            return { code: 5, stdout: '', stderr: '' };
          delete locals[key];
          return { code: 0, stdout: '', stderr: '' };
        }
        if (rest[4] === '--replace-all') {
          const key = rest[5] ?? '';
          const value = rest[6] ?? '';
          locals[key] = value;
          localWrites.push({ cwd, key, value });
          return { code: 0, stdout: '', stderr: '' };
        }
      }
      if (
        rest[0] === 'config' &&
        rest[1] === '--global' &&
        rest[2] === '--get'
      ) {
        const value = globals[rest[3] ?? ''];
        return value === undefined
          ? { code: 1, stdout: '', stderr: '' }
          : { code: 0, stdout: `${value}\n`, stderr: '' };
      }
      if (rest[0] === 'config' && rest[1] === '--file') {
        writes.push({
          path: rest[2] ?? '',
          key: rest[3] ?? '',
          value: rest[4] ?? '',
        });
        return { code: 0, stdout: '', stderr: '' };
      }
      throw new Error(`unscripted git argv: ${rest.join(' ')}`);
    },
  };
  return { run, writes, localWrites };
}

async function seed(home: string): Promise<void> {
  await saveState(identityFilePath(home), {
    personal: makeIdentity('Personal Name', 'personal@example.com'),
    work: makeIdentity('Work Name', 'work@example.com'),
  });
}

const fakeRepo = '/fake/repo';

sandboxTest(
  'showIdentity marks the active scope when git matches a profile',
  async (tempHome) => {
    const home = tempHome();
    await seed(home);
    const { run } = gitRunner({
      globals: {
        'user.name': 'Work Name',
        'user.email': 'work@example.com',
      },
    });

    const view = await showIdentity({ run, home, cwd: fakeRepo });

    expect(view.identities.personal?.email).toBe('personal@example.com');
    expect(view.current).toEqual({
      kind: 'matched',
      scope: 'work',
      identity: { name: 'Work Name', email: 'work@example.com' },
      origin: 'global',
    });
  },
);

sandboxTest(
  'showIdentity reports unmanaged when git matches no profile',
  async (tempHome) => {
    const home = tempHome();
    await seed(home);
    const { run } = gitRunner({
      globals: {
        'user.name': 'Someone Else',
        'user.email': 'other@example.com',
      },
    });

    const view = await showIdentity({ run, home, cwd: fakeRepo });
    expect(view.current.kind).toBe('unmanaged');
  },
);

sandboxTest(
  'showIdentity reports unset when git has no identity',
  async (tempHome) => {
    const home = tempHome();
    await seed(home);
    const { run } = gitRunner({});

    const view = await showIdentity({ run, home, cwd: fakeRepo });
    expect(view.current.kind).toBe('unset');
  },
);

sandboxTest(
  'showIdentity surfaces a half-configured identity as unmanaged',
  async (tempHome) => {
    const home = tempHome();
    await seed(home);
    const { run } = gitRunner({ globals: { 'user.name': 'Solo Name' } });

    const view = await showIdentity({ run, home, cwd: fakeRepo });
    expect(view.current).toEqual({
      kind: 'unmanaged',
      identity: { name: 'Solo Name', email: '' },
      origin: 'global',
    });
  },
);

sandboxTest(
  'showIdentity reports a repo-pinned identity as local and merges per key',
  async (tempHome) => {
    const home = tempHome();
    await seed(home);
    const { run } = gitRunner({
      inRepo: true,
      globals: {
        'user.name': 'Personal Name',
        'user.email': 'personal@example.com',
      },
      locals: { 'user.email': 'work@example.com' },
    });

    const view = await showIdentity({ run, home, cwd: fakeRepo });
    expect(view.current).toEqual({
      kind: 'unmanaged',
      identity: { name: 'Personal Name', email: 'work@example.com' },
      origin: 'local',
    });
  },
);

sandboxTest(
  'showIdentity reports global origin inside an unpinned repo',
  async (tempHome) => {
    const home = tempHome();
    await seed(home);
    const { run } = gitRunner({
      inRepo: true,
      globals: {
        'user.name': 'Work Name',
        'user.email': 'work@example.com',
      },
    });

    const view = await showIdentity({ run, home, cwd: fakeRepo });
    expect(view.current).toEqual({
      kind: 'matched',
      scope: 'work',
      identity: { name: 'Work Name', email: 'work@example.com' },
      origin: 'global',
    });
  },
);

sandboxTest(
  'showIdentity throws when no configuration exists',
  async (tempHome) => {
    const { run } = gitRunner({});
    await expect(
      showIdentity({ run, home: tempHome(), cwd: fakeRepo }),
    ).rejects.toBeInstanceOf(AppError);
  },
);

sandboxTest(
  'switchIdentity applies the stored identity to global git config',
  async (tempHome) => {
    const home = tempHome();
    await seed(home);
    const { run, writes } = gitRunner({});

    const result = await switchIdentity(
      { run, home, cwd: fakeRepo },
      'personal',
    );

    expect(result.identity).toEqual({
      name: 'Personal Name',
      email: 'personal@example.com',
    });
    expect(result.locallyPinned).toBe(false);
    expect(writes.map(({ key, value }) => ({ key, value }))).toEqual([
      { key: 'user.name', value: 'Personal Name' },
      { key: 'user.email', value: 'personal@example.com' },
    ]);
    expect(writes[0]?.path).toBe(writes[1]?.path);
    expect(writes[0]?.path).not.toBe(join(home, '.gitconfig'));
  },
);

sandboxTest(
  'switchIdentity reports a locally pinned repo even when the pin is partial',
  async (tempHome) => {
    const home = tempHome();
    await seed(home);
    const { run, writes } = gitRunner({
      inRepo: true,
      locals: { 'user.name': 'Pinned Name' },
    });

    const result = await switchIdentity(
      { run, home, cwd: fakeRepo },
      'personal',
    );

    expect(result.locallyPinned).toBe(true);
    expect(writes).toHaveLength(2);
  },
);

sandboxTest(
  'switchIdentity does not report a pin inside an unpinned repo',
  async (tempHome) => {
    const home = tempHome();
    await seed(home);
    const { run } = gitRunner({ inRepo: true });

    const result = await switchIdentity({ run, home, cwd: fakeRepo }, 'work');
    expect(result.locallyPinned).toBe(false);
  },
);

sandboxTest(
  'switchIdentity throws when no configuration exists',
  async (tempHome) => {
    const { run } = gitRunner({});
    await expect(
      switchIdentity({ run, home: tempHome(), cwd: fakeRepo }, 'work'),
    ).rejects.toBeInstanceOf(AppError);
  },
);

sandboxTest(
  'switchIdentity throws when the requested scope is unconfigured',
  async (tempHome) => {
    const home = tempHome();
    await saveState(identityFilePath(home), {
      personal: makeIdentity('Personal Name', 'personal@example.com'),
      work: null,
    });
    const { run } = gitRunner({});
    await expect(
      switchIdentity({ run, home, cwd: fakeRepo }, 'work'),
    ).rejects.toBeInstanceOf(AppError);
  },
);

sandboxTest(
  'pinIdentity writes both identity keys to the local config of cwd',
  async (tempHome) => {
    const home = tempHome();
    await seed(home);
    const { run, writes, localWrites } = gitRunner({ inRepo: true });

    const applied = await pinIdentity({ run, home, cwd: fakeRepo }, 'work');

    expect(applied).toEqual({ name: 'Work Name', email: 'work@example.com' });
    expect(localWrites).toEqual([
      { cwd: fakeRepo, key: 'user.name', value: 'Work Name' },
      { cwd: fakeRepo, key: 'user.email', value: 'work@example.com' },
    ]);
    expect(writes).toHaveLength(0);
  },
);

sandboxTest('pinIdentity throws outside a git repository', async (tempHome) => {
  const home = tempHome();
  await seed(home);
  const { run, localWrites } = gitRunner({ inRepo: false });

  await expect(
    pinIdentity({ run, home, cwd: fakeRepo }, 'work'),
  ).rejects.toBeInstanceOf(AppError);
  expect(localWrites).toHaveLength(0);
});

sandboxTest(
  'pinIdentity throws when the requested scope is unconfigured',
  async (tempHome) => {
    const home = tempHome();
    await saveState(identityFilePath(home), {
      personal: makeIdentity('Personal Name', 'personal@example.com'),
      work: null,
    });
    const { run, localWrites } = gitRunner({ inRepo: true });

    await expect(
      pinIdentity({ run, home, cwd: fakeRepo }, 'work'),
    ).rejects.toBeInstanceOf(AppError);
    expect(localWrites).toHaveLength(0);
  },
);

sandboxTest(
  'unpinIdentity removes the pin and reports the effective global identity',
  async (tempHome) => {
    const home = tempHome();
    await seed(home);
    const { run } = gitRunner({
      inRepo: true,
      globals: {
        'user.name': 'Personal Name',
        'user.email': 'personal@example.com',
      },
      locals: {
        'user.name': 'Work Name',
        'user.email': 'work@example.com',
      },
    });

    const result = await unpinIdentity({ run, home, cwd: fakeRepo });

    expect(result.kind).toBe('unpinned');
    expect(result.effective).toEqual({
      kind: 'matched',
      scope: 'personal',
      identity: { name: 'Personal Name', email: 'personal@example.com' },
      origin: 'global',
    });
  },
);

sandboxTest(
  'unpinIdentity reports already-global on an unpinned repository',
  async (tempHome) => {
    const home = tempHome();
    await seed(home);
    const { run } = gitRunner({
      inRepo: true,
      globals: {
        'user.name': 'Work Name',
        'user.email': 'work@example.com',
      },
    });

    const result = await unpinIdentity({ run, home, cwd: fakeRepo });
    expect(result.kind).toBe('already-global');
    expect(result.effective.kind).toBe('matched');
  },
);

sandboxTest(
  'unpinIdentity throws outside a git repository',
  async (tempHome) => {
    const { run } = gitRunner({ inRepo: false });
    await expect(
      unpinIdentity({ run, home: tempHome(), cwd: fakeRepo }),
    ).rejects.toBeInstanceOf(AppError);
  },
);

sandboxTest(
  'unpinIdentity works before any identity store exists',
  async (tempHome) => {
    const { run } = gitRunner({
      inRepo: true,
      locals: { 'user.name': 'Stray', 'user.email': 'stray@example.com' },
    });

    const result = await unpinIdentity({
      run,
      home: tempHome(),
      cwd: fakeRepo,
    });
    expect(result.kind).toBe('unpinned');
    expect(result.effective.kind).toBe('unset');
  },
);

sandboxTest(
  'setIdentity persists collected inputs and drops blank profiles',
  async (tempHome) => {
    const home = tempHome();
    const { path, state } = await setIdentity(
      { home },
      {
        personal: { name: 'Jane', email: 'jane@example.com' },
        work: { name: '', email: '' },
      },
    );

    expect(state.work).toBeNull();
    expect(await readState(path)).toEqual({
      personal: { name: 'Jane', email: 'jane@example.com' },
      work: null,
    });
  },
);

sandboxTest(
  'setIdentity rejects a scope with only one field filled',
  async (tempHome) => {
    const home = tempHome();
    await expect(
      setIdentity(
        { home },
        {
          personal: { name: 'Jane', email: '' },
          work: { name: '', email: '' },
        },
      ),
    ).rejects.toBeInstanceOf(AppError);
    // Nothing is written when validation fails.
    expect(await readState(identityFilePath(home))).toBeNull();
  },
);

/**
 * A runner isolated to the sandbox home: git's global config is redirected to
 * the overlay switchIdentity writes so `--global` reads observe it, the system
 * config is neutralized, and commit identity comes from env so the developer's
 * own setup never leaks in.
 */
function sandboxGitRunner(home: string): CommandRunner {
  const isolation = {
    GIT_CONFIG_GLOBAL: join(home, '.gitconfig'),
    GIT_CONFIG_SYSTEM: '/dev/null',
    GIT_AUTHOR_NAME: 'mev test',
    GIT_AUTHOR_EMAIL: 'test@example.invalid',
    GIT_COMMITTER_NAME: 'mev test',
    GIT_COMMITTER_EMAIL: 'test@example.invalid',
  };
  return {
    run: (command, args, options) =>
      bunCommandRunner.run(command, args, {
        ...options,
        env: { ...options?.env, ...isolation },
        stdout: 'pipe',
        stderr: 'pipe',
      }),
  };
}

async function git(run: CommandRunner, args: readonly string[]): Promise<void> {
  const result = await run.run('git', args);
  if (result.code !== 0) {
    throw new Error(
      `git ${args.join(' ')} failed: ${result.stderr.trim() || result.stdout.trim()}`,
    );
  }
}

// Exercised against real git because the fake above merely encodes our
// assumptions about git's contracts: the unset exit-code 5 signal and
// `--local` resolving through a linked worktree's .git file to the shared
// config are behaviors only git itself can confirm.
sandboxTest(
  'pin, show, and unpin agree with real git across repo and worktree',
  async (tempHome) => {
    const home = tempHome();
    await seed(home);
    const run = sandboxGitRunner(home);
    const repo = join(home, 'repo');
    const deps = { run, home, cwd: repo };
    await git(run, ['init', repo]);

    const switched = await switchIdentity(deps, 'personal');
    expect(switched.locallyPinned).toBe(false);
    expect((await showIdentity(deps)).current).toEqual({
      kind: 'matched',
      scope: 'personal',
      identity: { name: 'Personal Name', email: 'personal@example.com' },
      origin: 'global',
    });

    await pinIdentity(deps, 'work');
    expect((await showIdentity(deps)).current).toEqual({
      kind: 'matched',
      scope: 'work',
      identity: { name: 'Work Name', email: 'work@example.com' },
      origin: 'local',
    });
    expect((await switchIdentity(deps, 'personal')).locallyPinned).toBe(true);

    writeFileSync(join(repo, 'file.txt'), 'x\n');
    await git(run, ['-C', repo, 'add', 'file.txt']);
    await git(run, ['-C', repo, 'commit', '-m', 'init']);
    const worktree = join(home, 'worktree');
    await git(run, ['-C', repo, 'worktree', 'add', worktree]);
    const worktreeView = await showIdentity({ ...deps, cwd: worktree });
    expect(worktreeView.current).toMatchObject({
      kind: 'matched',
      scope: 'work',
      origin: 'local',
    });

    const unpinned = await unpinIdentity(deps);
    expect(unpinned.kind).toBe('unpinned');
    expect(unpinned.effective).toEqual({
      kind: 'matched',
      scope: 'personal',
      identity: { name: 'Personal Name', email: 'personal@example.com' },
      origin: 'global',
    });
    expect((await unpinIdentity(deps)).kind).toBe('already-global');
  },
);

// Real git because plain set/unset refuse a multi-valued key with the same
// exit 5 that signals "missing": only git can prove --replace-all/--unset-all
// converge on duplicated identity keys instead of misreporting them.
sandboxTest(
  'pin and unpin converge on duplicated local identity values',
  async (tempHome) => {
    const home = tempHome();
    await seed(home);
    const run = sandboxGitRunner(home);
    const repo = join(home, 'repo');
    const deps = { run, home, cwd: repo };
    await git(run, ['init', repo]);
    for (const value of ['Stray One', 'Stray Two']) {
      await git(run, [
        '-C',
        repo,
        'config',
        '--local',
        '--add',
        'user.name',
        value,
      ]);
      await git(run, [
        '-C',
        repo,
        'config',
        '--local',
        '--add',
        'user.email',
        `${value}@example.invalid`,
      ]);
    }

    await pinIdentity(deps, 'work');
    expect((await showIdentity(deps)).current).toEqual({
      kind: 'matched',
      scope: 'work',
      identity: { name: 'Work Name', email: 'work@example.com' },
      origin: 'local',
    });

    for (const value of ['Stray One', 'Stray Two']) {
      await git(run, [
        '-C',
        repo,
        'config',
        '--local',
        '--add',
        'user.name',
        value,
      ]);
    }
    const unpinned = await unpinIdentity(deps);
    expect(unpinned.kind).toBe('unpinned');
    expect(unpinned.effective.kind).toBe('unset');
    expect((await unpinIdentity(deps)).kind).toBe('already-global');
  },
);
