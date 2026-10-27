import { expect } from 'bun:test';
import { chmod, mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { sandboxedTest } from '../fixtures/temporary-directory';

const sandboxTest = sandboxedTest('mev-command-rewrite-');
const hook = resolve('src/assets/config/coder/hooks/pre-tool-use.sh');
const rewrite = resolve('src/assets/config/coder/rtk/rewrite.sh');

async function runHook(
  sandbox: string,
  input: unknown,
  mode = 'rewrite',
): Promise<string> {
  const bin = join(sandbox, 'bin');
  const rtkDirectory = join(sandbox, '.mev/rtk');
  await mkdir(bin, { recursive: true });
  await mkdir(rtkDirectory, { recursive: true });
  const jq = Bun.which('jq');
  if (!jq) throw new Error('Hook protocol tests require jq.');
  await symlink(jq, join(bin, 'jq'));
  await writeFile(join(rtkDirectory, 'rewrite.sh'), await readFile(rewrite));
  if (mode !== 'unavailable') {
    const executable = join(bin, 'rtk');
    await writeFile(
      executable,
      `#!/bin/bash
case "$MEV_TEST_REWRITE_MODE" in
  rewrite) printf 'rtk %s\\n' "$2" ;;
  unchanged) printf '%s\\n' "$2" ;;
  failure) exit 1 ;;
  empty) exit 0 ;;
esac
`,
    );
    await chmod(executable, 0o755);
  }
  // Bash and jq are the hook's protocol boundary; the requested command is never run.
  const child = Bun.spawn(['/bin/bash', hook], {
    env: {
      HOME: sandbox,
      PATH: `${bin}:/usr/bin:/bin`,
      MEV_TEST_REWRITE_MODE: mode,
    },
    stdin: new Blob([JSON.stringify(input)]),
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  expect(code).toBe(0);
  expect(stderr).toBe('');
  return stdout;
}

sandboxTest(
  'rewriting changes input without granting execution permission',
  async (sandbox) => {
    const toolInput = {
      command: 'git status',
      timeout: 1234,
      description: 'Inspect changes',
    };
    const output = JSON.parse(
      await runHook(sandbox, { tool_name: 'Bash', tool_input: toolInput }),
    );
    expect(output).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        updatedInput: { ...toolInput, command: 'rtk git status' },
      },
    });
  },
);

for (const mode of ['unchanged', 'failure', 'empty', 'unavailable']) {
  sandboxTest(`no rewrite output for ${mode} support`, async (sandbox) => {
    expect(
      await runHook(
        sandbox,
        { tool_name: 'Bash', tool_input: { command: 'git status' } },
        mode,
      ),
    ).toBe('');
  });
}

for (const input of [
  { tool_name: 'Read', tool_input: { command: 'git status' } },
  { tool_name: 'Bash', tool_input: {} },
  { tool_name: 'Bash', tool_input: { command: 'rg pattern' } },
  { tool_name: 'Bash', tool_input: { command: 'rtk git status' } },
]) {
  sandboxTest(
    `nonmatching input is unchanged: ${JSON.stringify(input)}`,
    async (sandbox) => {
      expect(await runHook(sandbox, input, 'unchanged')).toBe('');
    },
  );
}

/** A main worktree and one linked worktree, created by real git. */
async function worktrees(
  sandbox: string,
): Promise<{ readonly main: string; readonly linked: string }> {
  const main = join(sandbox, 'demo');
  const linked = join(sandbox, 'demo-feature');
  const env = {
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_SYSTEM: '/dev/null',
    GIT_AUTHOR_NAME: 'mev test',
    GIT_AUTHOR_EMAIL: 'test@example.invalid',
    GIT_COMMITTER_NAME: 'mev test',
    GIT_COMMITTER_EMAIL: 'test@example.invalid',
  };
  for (const args of [
    ['init', '--quiet', main],
    ['-C', main, 'commit', '--quiet', '--allow-empty', '-m', 'init'],
    ['-C', main, 'worktree', 'add', '--quiet', '-b', 'feature', linked],
  ]) {
    const child = Bun.spawn(['git', ...args], { env, stderr: 'pipe' });
    if ((await child.exited) !== 0) {
      throw new Error(
        `git ${args.join(' ')} failed: ${await new Response(child.stderr).text()}`,
      );
    }
  }
  return { main, linked };
}

sandboxTest(
  'a git command is not wrapped in rtk inside a linked worktree',
  async (sandbox) => {
    const { linked } = await worktrees(sandbox);

    expect(
      await runHook(sandbox, {
        tool_name: 'Bash',
        cwd: linked,
        tool_input: { command: 'git status' },
      }),
    ).toBe('');
  },
);

sandboxTest(
  'a git command is still wrapped in the main worktree',
  async (sandbox) => {
    const { main } = await worktrees(sandbox);
    const output = JSON.parse(
      await runHook(sandbox, {
        tool_name: 'Bash',
        cwd: main,
        tool_input: { command: 'git status' },
      }),
    );

    expect(output.hookSpecificOutput.updatedInput.command).toBe(
      'rtk git status',
    );
  },
);

sandboxTest(
  'a non-git command is still wrapped inside a linked worktree',
  async (sandbox) => {
    const { linked } = await worktrees(sandbox);
    const output = JSON.parse(
      await runHook(sandbox, {
        tool_name: 'Bash',
        cwd: linked,
        tool_input: { command: 'ls -la' },
      }),
    );

    expect(output.hookSpecificOutput.updatedInput.command).toBe('rtk ls -la');
  },
);
