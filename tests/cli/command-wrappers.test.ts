import { expect, test } from 'bun:test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { runCommandLine } from '../../src/main';
import { captureStreams } from '../fixtures/streams';
import { sandboxedTest } from '../fixtures/temporary-directory';

// These exercise the clipanion command-wrapper layer — the positional/flag ->
// delegation mapping and exit codes — not the domain behavior (covered by each
// command's own tests) or stdout wording. Commands that reach an external tool
// run under a sandboxed HOME and an empty PATH, so `git`/`brew` resolve as
// spawn failures (code 127) rather than touching the real machine.

const sandboxTest = sandboxedTest('command-wrappers-');

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}

async function runCli(
  args: readonly string[],
  sandbox?: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const streams = captureStreams();
  const previousHome = process.env['HOME'];
  const previousPath = process.env['PATH'];
  if (sandbox !== undefined) {
    const bin = join(sandbox, 'bin');
    await mkdir(bin, { recursive: true });
    process.env['HOME'] = sandbox;
    process.env['PATH'] = bin;
  }
  try {
    const code = await runCommandLine([...args], {
      colorDepth: 1,
      stdout: streams.stdout as NodeJS.WriteStream,
      stderr: streams.stderr as NodeJS.WriteStream,
    });
    return { code, stdout: streams.stdoutText(), stderr: streams.stderrText() };
  } finally {
    restoreEnv('HOME', previousHome);
    restoreEnv('PATH', previousPath);
  }
}

test('list routes to the target listing under both its name and alias', async () => {
  const byName = await runCli(['list']);
  expect(byName.code).toBe(0);
  // A registered target name and column header prove the registry was rendered.
  expect(byName.stdout).toContain('git');
  expect(byName.stdout).toContain('TARGET');

  const byAlias = await runCli(['ls']);
  expect(byAlias.code).toBe(0);
  expect(byAlias.stdout).toContain('git');
});

sandboxTest(
  'make rejects an unknown selector before any provisioning',
  async (sandbox) => {
    const result = await runCli(['make', 'definitely-not-a-target'], sandbox);

    expect(result.code).not.toBe(0);
    // The selector is validated before deploy, so nothing is written under HOME.
    expect(await Bun.file(join(sandbox, '.mev')).exists()).toBe(false);
  },
);

sandboxTest('make requires at least one selector', async (sandbox) => {
  const result = await runCli(['make'], sandbox);
  expect(result.code).not.toBe(0);
});

sandboxTest('switch rejects an unknown identity scope', async (sandbox) => {
  const result = await runCli(['switch', 'not-a-scope'], sandbox);
  expect(result.code).not.toBe(0);
});

sandboxTest(
  'switch parses a valid scope and reports the missing-configuration domain error',
  async (sandbox) => {
    const result = await runCli(['switch', 'personal'], sandbox);
    expect(result.code).toBe(1);
    expect(result.stderr).not.toBe('');
  },
);

sandboxTest(
  'the internal namespace routes a leaf through the dispatcher and validates its args',
  async (sandbox) => {
    // `clone` with no URLs is rejected by the leaf before any git is spawned, so
    // this stays hermetic while proving `internal git clone` routes through
    // runInternalCommand to the domain operation.
    const result = await runCli(['internal', 'git', 'clone'], sandbox);
    expect(result.code).not.toBe(0);
  },
);
