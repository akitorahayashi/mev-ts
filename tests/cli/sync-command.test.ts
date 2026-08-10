import { expect } from 'bun:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { embeddedAssets } from '../../src/assets/registry';
import { appliedPath, writeApplied } from '../../src/provisioning/applied';
import { deployRole } from '../../src/provisioning/deploy';
import { fullSetupTargets } from '../../src/provisioning/registry';
import { isScanError, scanTargets } from '../../src/provisioning/scan';
import { targetSignature } from '../../src/provisioning/signature';
import { recordingContext } from '../fixtures/fake-context';
import { type CliResult, runCliInSandbox } from '../fixtures/sandboxed-cli';
import { sandboxedTest } from '../fixtures/temporary-directory';

const sandboxTest = sandboxedTest('sync-command-');

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

function runSync(
  sandbox: string,
  extraArgs: readonly string[] = [],
): Promise<CliResult> {
  return runCliInSandbox(['sync', ...extraArgs], sandbox);
}

sandboxTest(
  'sync exits without provisioning when the full setup is current',
  async (sandbox) => {
    await seedCurrentEnvironment(sandbox);

    const { code, stdout, stderr } = await runSync(sandbox);

    expect(code).toBe(0);
    expect(stdout).toContain('mev: environment is synchronized');
    expect(stderr).toBe('');
  },
);

sandboxTest(
  'sync --upgrade stays a no-op when the full setup is current',
  async (sandbox) => {
    // Upgrade mode never widens the selection: a synchronized environment must
    // exit without provisioning or network access even under --upgrade.
    await seedCurrentEnvironment(sandbox);

    const { code, stdout, stderr } = await runSync(sandbox, ['--upgrade']);

    expect(code).toBe(0);
    expect(stdout).toContain('mev: environment is synchronized');
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
    expect(stdout).toContain('mev: environment is synchronized');
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
