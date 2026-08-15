import { expect } from 'bun:test';
import { chmod, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { sandboxedTest } from '../fixtures/temporary-directory';

const sandboxTest = sandboxedTest('mev-git-shell-');

const gitShellAsset = resolve(
  import.meta.dir,
  '../../src/assets/config/shell/alias/git.zsh',
);
const gitConfigAsset = resolve(
  import.meta.dir,
  '../../src/assets/config/git/.gitconfig',
);

async function executable(path: string, contents: string): Promise<void> {
  await writeFile(path, contents);
  await chmod(path, 0o755);
}

sandboxTest(
  'interactive git clone routes through gv and retains an explicit native escape',
  async (sandbox) => {
    const bin = join(sandbox, 'bin');
    const gitLog = join(sandbox, 'git.log');
    const gvLog = join(sandbox, 'gv.log');
    await mkdir(bin);
    await executable(
      join(bin, 'git'),
      '#!/bin/sh\nif [ "$1" = config ]; then exit 0; fi\nprintf \'%s\\n\' "$*" >> "$MEV_TEST_GIT_LOG"\n',
    );
    await executable(
      join(bin, 'gv'),
      '#!/bin/sh\nprintf \'%s\\n\' "$*" >> "$MEV_TEST_GV_LOG"\n',
    );

    const process = Bun.spawn(
      [
        '/bin/zsh',
        '-f',
        '-c',
        'source "$MEV_TEST_GIT_ASSET"\ngit clone repo-a\neval \'g clone repo-b\'\ngit status\ncommand git clone repo-c\ngit -C elsewhere clone repo-d',
      ],
      {
        env: {
          ...Bun.env,
          MEV_TEST_GIT_ASSET: gitShellAsset,
          MEV_TEST_GIT_LOG: gitLog,
          MEV_TEST_GV_LOG: gvLog,
          PATH: `${bin}:/usr/bin:/bin`,
        },
        stdout: 'pipe',
        stderr: 'pipe',
      },
    );

    expect(await process.exited).toBe(0);
    expect(await readFile(gvLog, 'utf8')).toBe('clone repo-a\nclone repo-b\n');
    expect(await readFile(gitLog, 'utf8')).toBe(
      'status\nclone repo-c\n-C elsewhere clone repo-d\n',
    );
  },
);

sandboxTest(
  'interactive git clone fails with recovery guidance when gv is unavailable',
  async (sandbox) => {
    const bin = join(sandbox, 'bin');
    await mkdir(bin);
    await executable(
      join(bin, 'git'),
      '#!/bin/sh\nif [ "$1" = config ]; then exit 0; fi\nexit 0\n',
    );

    const process = Bun.spawn(
      ['/bin/zsh', '-f', '-c', 'source "$MEV_TEST_GIT_ASSET"\ngit clone repo'],
      {
        env: {
          ...Bun.env,
          MEV_TEST_GIT_ASSET: gitShellAsset,
          PATH: `${bin}:/usr/bin:/bin`,
        },
        stdout: 'pipe',
        stderr: 'pipe',
      },
    );

    const stderr = await new Response(process.stderr).text();
    expect(await process.exited).toBe(127);
    expect(stderr).toContain("run 'mev make grove --upgrade'");
  },
);

sandboxTest(
  'rf-cl runs gv clone from the references directory with unchanged arguments',
  async (sandbox) => {
    const bin = join(sandbox, 'bin');
    const repository = join(sandbox, 'repository');
    const gvLog = join(sandbox, 'gv.log');
    await mkdir(bin);
    await mkdir(repository);
    await executable(
      join(bin, 'gv'),
      '#!/bin/sh\nprintf \'%s|%s\\n\' "$PWD" "$*" >> "$MEV_TEST_GV_LOG"\n',
    );

    const init = Bun.spawnSync(['/usr/bin/git', 'init', '-q', repository]);
    expect(init.exitCode).toBe(0);
    const process = Bun.spawn(
      [
        '/usr/bin/git',
        'rf-cl',
        '--depth',
        '1',
        'https://example.com/repo.git',
        'target',
      ],
      {
        cwd: repository,
        env: {
          ...Bun.env,
          GIT_CONFIG_GLOBAL: gitConfigAsset,
          GIT_CONFIG_NOSYSTEM: '1',
          MEV_TEST_GV_LOG: gvLog,
          PATH: `${bin}:/usr/bin:/bin`,
        },
        stdout: 'pipe',
        stderr: 'pipe',
      },
    );

    expect(await process.exited).toBe(0);
    const canonicalRepository = await realpath(repository);
    expect(await readFile(gvLog, 'utf8')).toBe(
      `${join(canonicalRepository, 'references')}|clone --depth 1 https://example.com/repo.git target\n`,
    );
    expect(
      await readFile(join(repository, 'references/.gitignore'), 'utf8'),
    ).toBe('*\n');
  },
);

sandboxTest(
  'wcd moves the shell into the resolved worktree',
  async (sandbox) => {
    const bin = join(sandbox, 'bin');
    const target = join(sandbox, 'demo-feature-a');
    await mkdir(bin);
    await mkdir(target);
    // `w-p` is the only subcommand wcd calls, and its whole contract is one path
    // on stdout.
    await executable(
      join(bin, 'git'),
      `#!/bin/sh\nprintf '%s\\n' "${target}"\n`,
    );

    const process = Bun.spawn(
      [
        '/bin/zsh',
        '-f',
        '-c',
        'source "$MEV_TEST_GIT_ASSET"\nwcd feature-a\nprint -r -- "$PWD"',
      ],
      {
        env: {
          ...Bun.env,
          MEV_TEST_GIT_ASSET: gitShellAsset,
          PATH: `${bin}:/usr/bin:/bin`,
        },
        stdout: 'pipe',
        stderr: 'pipe',
      },
    );

    const stdout = await new Response(process.stdout).text();
    expect(await process.exited).toBe(0);
    // zsh's cd keeps the logical path, so $PWD is what w-p printed rather than
    // its resolution through the /var symlink macOS puts in front of $TMPDIR.
    expect(stdout.trim()).toBe(target);
  },
);

sandboxTest(
  'wcd surfaces a failure that would otherwise be swallowed by the substitution',
  async (sandbox) => {
    const bin = join(sandbox, 'bin');
    await mkdir(bin);
    // Clipanion prints a usage error on stdout, which command substitution
    // captures instead of showing. Only a real shell can express that, which is
    // why this case cannot be covered by a fake CommandRunner.
    await executable(
      join(bin, 'git'),
      "#!/bin/sh\nprintf '%s\\n' 'No worktree matches: typo.'\nexit 1\n",
    );

    const process = Bun.spawn(
      [
        '/bin/zsh',
        '-f',
        '-c',
        'source "$MEV_TEST_GIT_ASSET"\ncd "$MEV_TEST_HOME"\nwcd typo\nprint -r -- "exit=$?"\nprint -r -- "$PWD"',
      ],
      {
        env: {
          ...Bun.env,
          MEV_TEST_GIT_ASSET: gitShellAsset,
          MEV_TEST_HOME: sandbox,
          PATH: `${bin}:/usr/bin:/bin`,
        },
        stdout: 'pipe',
        stderr: 'pipe',
      },
    );

    const stdout = await new Response(process.stdout).text();
    const stderr = await new Response(process.stderr).text();
    await process.exited;

    expect(stdout).toContain('exit=1');
    // The shell stayed where it was rather than following a failed lookup.
    expect(stdout.trim().split('\n').at(-1)).toBe(sandbox);
    expect(stderr).toContain('No worktree matches: typo.');
  },
);
