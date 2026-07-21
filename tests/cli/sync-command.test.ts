import { expect } from 'bun:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { embeddedAssets } from '../../src/assets/registry';
import { runCommandLine } from '../../src/main';
import { appliedPath, writeApplied } from '../../src/provisioning/applied';
import { deployRole } from '../../src/provisioning/deploy';
import { fullSetupTargets } from '../../src/provisioning/registry';
import { isScanError, scanTargets } from '../../src/provisioning/scan';
import { targetSignature } from '../../src/provisioning/signature';
import { recordingContext } from '../fixtures/fake-context';
import { captureStreams } from '../fixtures/streams';
import { sandboxedTest } from '../fixtures/temporary-directory';

const sandboxTest = sandboxedTest('sync-command-');

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}

async function seedCurrentEnvironment(sandbox: string): Promise<void> {
  const context = recordingContext({
    home: sandbox,
    assets: embeddedAssets,
  }).context;
  for (const target of fullSetupTargets()) {
    await deployRole(target.role, context);
    await writeApplied(
      appliedPath(sandbox, target.name),
      await targetSignature(target, embeddedAssets),
    );
  }
}

/** Run `mev sync` with a sandboxed HOME/PATH, capturing its streams. */
async function runSync(
  sandbox: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const streams = captureStreams();
  const previousHome = process.env['HOME'];
  const previousPath = process.env['PATH'];
  const bin = join(sandbox, 'bin');
  await mkdir(bin, { recursive: true });
  process.env['HOME'] = sandbox;
  process.env['PATH'] = bin;
  try {
    const code = await runCommandLine(['sync'], {
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

sandboxTest(
  'sync exits without provisioning when the full setup is current',
  async (sandbox) => {
    await seedCurrentEnvironment(sandbox);

    const { code, stdout, stderr } = await runSync(sandbox);

    expect(code).toBe(0);
    expect(stdout).toBe('mev: environment is synchronized\n');
    expect(stderr).toBe('');
  },
);

sandboxTest(
  'sync cleans obsolete mev state even when the full setup is current',
  async (sandbox) => {
    await seedCurrentEnvironment(sandbox);
    await mkdir(join(sandbox, '.mev/roles/cmux'), { recursive: true });
    await writeFile(join(sandbox, '.mev/roles/cmux/config.yml'), 'stale');
    await writeApplied(
      appliedPath(sandbox, 'cmux'),
      'sha256:0000000000000000000000000000000000000000000000000000000000000000',
    );

    const { code, stdout, stderr } = await runSync(sandbox);

    expect(code).toBe(0);
    expect(stdout).toContain('mev: Cleaned obsolete provisioning state\n');
    expect(stdout).toContain('Removed obsolete role state: cmux\n');
    expect(stdout).toContain('Removed obsolete applied marker: cmux\n');
    expect(stdout.endsWith('mev: environment is synchronized\n')).toBe(true);
    expect(await Bun.file(join(sandbox, '.mev/roles/cmux')).exists()).toBe(
      false,
    );
    expect(await Bun.file(appliedPath(sandbox, 'cmux')).exists()).toBe(false);
    expect(stderr).toBe('');
  },
);

sandboxTest(
  'a deployed role whose applied marker diverges is classified stale',
  async (sandbox) => {
    // Independent oracle: a fixed digest that cannot equal any real signature,
    // so "synchronized" is contingent on the staleness comparison, not on
    // seeding with targetSignature itself.
    const [target] = fullSetupTargets();
    if (!target) throw new Error('no full-setup targets registered');
    const context = recordingContext({
      home: sandbox,
      assets: embeddedAssets,
    }).context;
    await deployRole(target.role, context);
    await writeApplied(
      appliedPath(sandbox, target.name),
      `sha256:${'0'.repeat(64)}`,
    );

    const [scan] = await scanTargets([target], context);

    expect(scan && !isScanError(scan) ? scan.reasons : null).toContain(
      'signature',
    );
  },
);
