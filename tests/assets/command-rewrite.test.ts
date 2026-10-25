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
