import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { runCliInSandbox as runCli } from '../fixtures/sandboxed-cli';
import { sandboxedTest } from '../fixtures/temporary-directory';

// These exercise the clipanion command-wrapper layer — the positional/flag ->
// delegation mapping and exit codes — not the domain behavior (covered by each
// command's own tests) or stdout wording. Commands that reach an external tool
// run under a sandboxed HOME and an empty PATH, so `git`/`brew` resolve as
// spawn failures (code 127) rather than touching the real machine.

const sandboxTest = sandboxedTest('command-wrappers-');

test('list routes to the target listing under both its name and alias', async () => {
  const byName = await runCli(['list']);
  expect(byName.code).toBe(0);
  expect(byName.stdout).toContain('git');
  expect(byName.stdout).toContain('TARGET');
  // Styling follows the injected sink, not the terminal the suite runs in, so
  // this holds whether or not the run is interactive.
  expect(byName.stdout).not.toContain('\x1b[');

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

sandboxTest(
  'make consumes --upgrade as a flag rather than a selector',
  async (sandbox) => {
    const result = await runCli(
      ['make', '-u', 'definitely-not-a-target'],
      sandbox,
    );

    expect(result.code).not.toBe(0);
    // The usage error names the selector, proving -u was parsed as an option
    // and the command still reached selector validation.
    expect(result.stdout).toContain('definitely-not-a-target');
    expect(await Bun.file(join(sandbox, '.mev')).exists()).toBe(false);
  },
);

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

// Internal leaves invoked with arguments their own validation rejects. The
// rejection naming the leaf's path is the evidence that it resolved through
// runInternalCommand rather than stopping at the namespace.
//
// `internal gh labels deploy` and `reset` are deliberately absent: they take no
// required arguments and act immediately, so invoking them here would reach the
// real GitHub API. Their routing is covered by the namespace overview test, and
// their behavior by tests/internal/gh/.
const INTERNAL_LEAVES = [
  ['internal', 'git', 'clone'],
  ['internal', 'git', 'delete-branches'],
  ['internal', 'git', 'delete-submodule'],
  ['internal', 'document', 'markdown-to-pdf'],
  ['internal', 'document', 'pdf-to-markdown'],
];

for (const path of INTERNAL_LEAVES) {
  sandboxTest(
    `${path.join(' ')} routes through the internal dispatcher`,
    async (sandbox) => {
      const result = await runCli(path, sandbox);

      expect(result.code).not.toBe(0);
      // The rejection names this leaf's own path. An unresolved path would
      // instead list the namespace's candidates without settling on one.
      expect(`${result.stdout}${result.stderr}`).toContain(path.join(' '));
    },
  );
}
