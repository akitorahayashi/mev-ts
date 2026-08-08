import { expect, test } from 'bun:test';
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

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

async function withSandbox(
  run: (sandbox: string) => Promise<void>,
): Promise<void> {
  const sandbox = await mkdtemp(join(tmpdir(), 'mev-git-shell-'));
  try {
    await run(sandbox);
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
}

test('interactive git clone routes through gv and retains an explicit native escape', () =>
  withSandbox(async (sandbox) => {
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
  }));

test('interactive git clone fails with recovery guidance when gv is unavailable', () =>
  withSandbox(async (sandbox) => {
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
  }));

test('rf-cl runs gv clone from the references directory with unchanged arguments', () =>
  withSandbox(async (sandbox) => {
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
  }));
