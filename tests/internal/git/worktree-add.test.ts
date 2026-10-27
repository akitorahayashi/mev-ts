import { expect } from 'bun:test';
import {
  lstat,
  mkdir,
  readFile,
  readlink,
  realpath,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import { CommandLineError } from '../../../src/errors';
import { lstatIfPresent } from '../../../src/host/absence';
import {
  bunCommandRunner,
  type CommandResult,
  type CommandRunner,
} from '../../../src/host/command';
import { addWorktrees } from '../../../src/internal/git/worktree/add';
import { removeWorktrees } from '../../../src/internal/git/worktree/remove';
import { sandboxedTest } from '../../fixtures/temporary-directory';

// Real git throughout: the subjects are git's own checkout, filter, ignore, and
// fetch behavior, which a scripted runner could only restate.
const sandboxTest = sandboxedTest('mev-worktree-add-');

interface Fixture {
  readonly root: string;
  readonly origin: string;
  readonly main: string;
  /** A runner standing in `cwd`, isolated from the developer's git config. */
  run(cwd: string): CommandRunner;
  git(cwd: string, args: readonly string[]): Promise<string>;
  attempt(cwd: string, args: readonly string[]): Promise<CommandResult>;
  /** Push a commit to origin from elsewhere, leaving `main`'s refs stale. */
  advanceOrigin(branch: string): Promise<string>;
}

async function fixture(
  root: string,
  globalIgnore = '.tmp\n*.local.*\n',
): Promise<Fixture> {
  const xdg = join(root, 'xdg');
  await mkdir(join(xdg, 'git'), { recursive: true });
  await writeFile(join(xdg, 'git', 'ignore'), globalIgnore);
  const env = {
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_SYSTEM: '/dev/null',
    XDG_CONFIG_HOME: xdg,
    GIT_AUTHOR_NAME: 'mev test',
    GIT_AUTHOR_EMAIL: 'test@example.invalid',
    GIT_COMMITTER_NAME: 'mev test',
    GIT_COMMITTER_EMAIL: 'test@example.invalid',
  };

  const run = (cwd: string): CommandRunner => ({
    run: (command, args, options) =>
      bunCommandRunner.run(command, args, {
        ...options,
        cwd,
        env: { ...options?.env, ...env },
        stdout: 'pipe',
        stderr: 'pipe',
      }),
  });
  const attempt = (cwd: string, args: readonly string[]) =>
    run(cwd).run('git', args);
  const git = async (cwd: string, args: readonly string[]) => {
    const result = await attempt(cwd, args);
    if (result.code !== 0) {
      throw new Error(
        `git ${args.join(' ')} failed: ${result.stderr.trim() || result.stdout.trim()}`,
      );
    }
    return result.stdout.trim();
  };

  const origin = join(root, 'origin.git');
  const seed = join(root, 'seed');
  const main = join(root, 'demo');
  await git(root, [
    'init',
    '--quiet',
    '--bare',
    '--initial-branch=main',
    origin,
  ]);
  await git(root, ['clone', '--quiet', origin, seed]);
  await git(seed, ['commit', '--quiet', '--allow-empty', '-m', 'init']);
  await git(seed, ['push', '--quiet', 'origin', 'HEAD:main']);
  await git(root, ['clone', '--quiet', origin, main]);

  let count = 0;
  const advanceOrigin = async (branch: string) => {
    count += 1;
    await git(seed, ['fetch', '--quiet', 'origin']);
    const known = await attempt(seed, [
      'rev-parse',
      '--verify',
      '--quiet',
      `origin/${branch}`,
    ]);
    const base = known.code === 0 ? `origin/${branch}` : 'origin/main';
    await git(seed, ['checkout', '--quiet', '-B', branch, base]);
    await git(seed, [
      'commit',
      '--quiet',
      '--allow-empty',
      '-m',
      `advance ${count}`,
    ]);
    await git(seed, ['push', '--quiet', 'origin', `HEAD:${branch}`]);
    return git(seed, ['rev-parse', 'HEAD']);
  };

  return { root, origin, main, run, git, attempt, advanceOrigin };
}

/** Commit files on `main` and publish them, so new branches start with them. */
async function publish(
  f: Fixture,
  files: Readonly<Record<string, string>>,
): Promise<void> {
  for (const [path, content] of Object.entries(files)) {
    await writeFile(join(f.main, path), content);
    await f.git(f.main, ['add', '--', path]);
  }
  await f.git(f.main, ['commit', '--quiet', '-m', 'publish']);
  await f.git(f.main, ['push', '--quiet', 'origin', 'main']);
}

sandboxTest(
  'a new branch starts from the fetched default branch, whichever worktree invokes it',
  async (root) => {
    const f = await fixture(root);
    await f.git(f.main, [
      'worktree',
      'add',
      '--quiet',
      '-b',
      'feature/base',
      '../demo-feature-base',
    ]);
    const elsewhere = join(root, 'demo-feature-base');
    await f.git(elsewhere, [
      'commit',
      '--quiet',
      '--allow-empty',
      '-m',
      'unrelated work',
    ]);
    const tip = await f.advanceOrigin('main');

    await addWorktrees(f.run(elsewhere), ['feature/new']);

    expect(await f.git(f.main, ['rev-parse', 'feature/new'])).toBe(tip);
    // An upstream of origin/main would make `git pull` there merge main.
    const upstream = await f.attempt(f.main, [
      'rev-parse',
      '--abbrev-ref',
      'feature/new@{upstream}',
    ]);
    expect(upstream.code).not.toBe(0);
    expect((await lstat(join(root, 'demo-feature-new'))).isDirectory()).toBe(
      true,
    );
  },
);

sandboxTest(
  '--from starts new branches at that ref without fetching',
  async (root) => {
    const f = await fixture(root);
    const seen = await f.git(f.main, ['rev-parse', 'origin/main']);
    await f.git(f.main, [
      'commit',
      '--quiet',
      '--allow-empty',
      '-m',
      'local only',
    ]);
    const local = await f.git(f.main, ['rev-parse', 'HEAD']);
    await f.advanceOrigin('main');

    await addWorktrees(f.run(f.main), ['feature/x', '--from', 'main']);

    expect(await f.git(f.main, ['rev-parse', 'feature/x'])).toBe(local);
    expect(await f.git(f.main, ['rev-parse', 'origin/main'])).toBe(seen);
  },
);

sandboxTest(
  '--from is refused when no requested branch is new',
  async (root) => {
    const f = await fixture(root);
    await f.git(f.main, ['branch', 'feature/old']);

    await expect(
      addWorktrees(f.run(f.main), ['feature/old', '--from=main']),
    ).rejects.toThrow('applies only to new branches');
  },
);

sandboxTest('without origin a new branch asks for --from', async (root) => {
  const f = await fixture(root);
  await f.git(f.main, ['remote', 'remove', 'origin']);

  const failure = addWorktrees(f.run(f.main), ['feature/new']);

  await expect(failure).rejects.toBeInstanceOf(CommandLineError);
  await expect(failure).rejects.toThrow('--from');
});

sandboxTest(
  'an existing local branch is checked out without the network',
  async (root) => {
    const f = await fixture(root);
    await f.git(f.main, ['branch', 'feature/old']);
    await f.git(f.main, [
      'remote',
      'set-url',
      'origin',
      join(root, 'unreachable.git'),
    ]);

    await addWorktrees(f.run(f.main), ['feature/old']);

    expect(
      await f.git(join(root, 'demo-feature-old'), ['branch', '--show-current']),
    ).toBe('feature/old');
  },
);

sandboxTest(
  'a branch the clone has not fetched yet is tracked at its remote tip',
  async (root) => {
    const f = await fixture(root);
    const tip = await f.advanceOrigin('feature/remote');

    await addWorktrees(f.run(f.main), ['feature/remote']);

    expect(await f.git(f.main, ['rev-parse', 'feature/remote'])).toBe(tip);
    expect(
      await f.git(f.main, [
        'rev-parse',
        '--abbrev-ref',
        'feature/remote@{upstream}',
      ]),
    ).toBe('origin/feature/remote');
  },
);

sandboxTest(
  'a remote whose name contains a slash is tracked by its full name',
  async (root) => {
    const f = await fixture(root);
    const team = join(root, 'team.git');
    await f.git(root, ['clone', '--quiet', '--bare', f.origin, team]);
    await f.git(f.main, ['remote', 'add', 'team/upstream', team]);
    await f.git(f.main, [
      'push',
      '--quiet',
      'team/upstream',
      'HEAD:refs/heads/feature/team',
    ]);
    await f.git(f.main, ['fetch', '--quiet', 'team/upstream']);

    await addWorktrees(f.run(f.main), ['feature/team']);

    expect(
      await f.git(f.main, [
        'rev-parse',
        '--abbrev-ref',
        'feature/team@{upstream}',
      ]),
    ).toBe('team/upstream/feature/team');
  },
);

sandboxTest(
  'a required filter that finds its key through the git directory checks out, and removal keeps the key',
  async (root) => {
    const f = await fixture(root);
    // Models git-crypt, which reads its key from `rev-parse --git-dir`: in a
    // linked worktree that is the private per-worktree directory.
    const smudge = join(root, 'smudge.sh');
    await writeFile(
      smudge,
      '#!/bin/sh\ntest -f "$(git rev-parse --git-dir)/git-crypt/keys/default" || exit 1\nexec cat\n',
    );
    await f.git(f.main, ['config', 'filter.crypt.smudge', `sh ${smudge}`]);
    await f.git(f.main, ['config', 'filter.crypt.clean', 'cat']);
    await f.git(f.main, ['config', 'filter.crypt.required', 'true']);
    const keys = join(f.main, '.git', 'git-crypt', 'keys');
    await mkdir(keys, { recursive: true });
    await writeFile(join(keys, 'default'), 'key');
    await publish(f, {
      '.gitattributes': 'secret.txt filter=crypt\n',
      'secret.txt': 'decrypted',
    });

    await addWorktrees(f.run(f.main), ['feature/crypt']);

    expect(
      await readFile(join(root, 'demo-feature-crypt', 'secret.txt'), 'utf8'),
    ).toBe('decrypted');

    // The worktree's private directory links to the shared keys; removing the
    // worktree must drop the link, never what it points at.
    await removeWorktrees(f.run(f.main), ['feature/crypt']);
    expect(await readFile(join(keys, 'default'), 'utf8')).toBe('key');
  },
);

sandboxTest(
  '.tmp is shared with the main worktree and outlives the worktree',
  async (root) => {
    const f = await fixture(root);
    await mkdir(join(f.main, '.tmp'));
    await writeFile(join(f.main, '.tmp', 'note.md'), 'kept');

    await addWorktrees(f.run(f.main), ['feature/shared']);
    const worktree = join(root, 'demo-feature-shared');
    // git records the main worktree by its resolved path, `/private/var` and all.
    expect(await readlink(join(worktree, '.tmp'))).toBe(
      await realpath(join(f.main, '.tmp')),
    );
    await writeFile(join(worktree, '.tmp', 'from-worktree.md'), 'written');

    await removeWorktrees(f.run(f.main), ['feature/shared']);

    expect(await lstatIfPresent(worktree)).toBeNull();
    expect(await readFile(join(f.main, '.tmp', 'note.md'), 'utf8')).toBe(
      'kept',
    );
    expect(
      await readFile(join(f.main, '.tmp', 'from-worktree.md'), 'utf8'),
    ).toBe('written');
  },
);

sandboxTest(
  'a .tmp link that would not be ignored rolls the whole request back',
  async (root) => {
    const f = await fixture(root, '*.local.*\n');

    await expect(
      addWorktrees(f.run(f.main), ['feature/a', 'feature/b']),
    ).rejects.toThrow('would not be ignored');

    for (const branch of ['feature/a', 'feature/b']) {
      const verified = await f.attempt(f.main, [
        'rev-parse',
        '--verify',
        '--quiet',
        branch,
      ]);
      expect(verified.code).not.toBe(0);
    }
    expect(await lstatIfPresent(join(root, 'demo-feature-a'))).toBeNull();
    expect(await lstatIfPresent(join(root, 'demo-feature-b'))).toBeNull();
    expect(await lstatIfPresent(join(f.main, '.tmp'))).toBeNull();
  },
);

sandboxTest(
  'ignored files are carried, globally ignored local settings included',
  async (root) => {
    const f = await fixture(root);
    await publish(f, { '.gitignore': '.env\nPods/\n' });
    await writeFile(join(f.main, '.env'), 'TOKEN=1');
    await mkdir(join(f.main, 'Pods'));
    await writeFile(join(f.main, 'Pods', 'Manifest.lock'), 'pods');
    await mkdir(join(f.main, '.claude'));
    await writeFile(join(f.main, '.claude', 'settings.local.json'), '{}');

    await addWorktrees(f.run(f.main), ['feature/carry']);

    const worktree = join(root, 'demo-feature-carry');
    expect(await readFile(join(worktree, '.env'), 'utf8')).toBe('TOKEN=1');
    expect(
      await readFile(join(worktree, 'Pods', 'Manifest.lock'), 'utf8'),
    ).toBe('pods');
    expect(
      await readFile(join(worktree, '.claude', 'settings.local.json'), 'utf8'),
    ).toBe('{}');
  },
);
