import { expect } from 'bun:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { configSelect } from '../../src/app/coder';
import { deployedDir } from '../../src/assets/ref';
import { embeddedAssets } from '../../src/assets/registry';
import { acquireMutationLease } from '../../src/host/mutation-lease';
import { appliedPath, writeApplied } from '../../src/provisioning/applied';
import { deployRole } from '../../src/provisioning/deploy';
import { fullSetupTargets } from '../../src/provisioning/registry';
import { isScanError, scanTargets } from '../../src/provisioning/scan';
import { targetSignature } from '../../src/provisioning/signature';
import { recordingContext } from '../fixtures/fake-context';
import { interruptSwap } from '../fixtures/interrupted-swap';
import { type CliResult, runCliInSandbox } from '../fixtures/sandboxed-cli';
import { sandboxedTest } from '../fixtures/temporary-directory';

const sandboxTest = sandboxedTest('sync-command-');

sandboxTest(
  'sync recovers missing deployed state before scanning and pruning',
  async (sandbox) => {
    await seedCurrentEnvironment(sandbox);
    const role = deployedDir('git', sandbox);
    await interruptSwap(sandbox, 'backed-up', 'copy', role);
    expect(await Bun.file(join(role, '.gitconfig')).exists()).toBe(false);
    await mkdir(join(sandbox, '.mev/roles/obsolete'), { recursive: true });
    await writeFile(join(sandbox, '.mev/roles/obsolete/file'), 'obsolete');
    const result = await runSync(sandbox);
    expect(result.code).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('No targets need reapplying');
    expect(await Bun.file(join(role, '.gitconfig')).exists()).toBe(true);
    expect(
      await Bun.file(join(sandbox, '.mev/roles/obsolete/file')).exists(),
    ).toBe(false);
  },
);

sandboxTest(
  'configuration catalog reads follow recovery of the interrupted role',
  async (sandbox) => {
    await seedCurrentEnvironment(sandbox);
    await interruptSwap(
      sandbox,
      'backed-up',
      'copy',
      deployedDir('coder', sandbox),
    );
    let prompted = false;
    await configSelect(
      'agents',
      sandbox,
      () => {},
      async (_message, catalog) => {
        prompted = true;
        expect(catalog.length).toBeGreaterThan(0);
        return null;
      },
    );
    expect(prompted).toBe(true);
  },
);

sandboxTest(
  'legacy backups stop sync before obsolete-role pruning',
  async (sandbox) => {
    await seedCurrentEnvironment(sandbox);
    const legacy = join(
      sandbox,
      '.mev/roles/obsolete/.resource.abcdef/backup/keep',
    );
    await mkdir(join(legacy, '..'), { recursive: true });
    await writeFile(legacy, 'previous contents');
    const result = await runSync(sandbox);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('Unrecorded transaction artifact');
    expect(await Bun.file(legacy).text()).toBe('previous contents');
    expect(result.stdout).not.toContain('No targets need reapplying');
  },
);

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
    expect(stdout).toContain('No targets need reapplying.');
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
    expect(stdout).toContain('No targets need reapplying.');
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
    expect(stdout).toContain('No targets need reapplying.');
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

sandboxTest(
  'a conflicting lease prevents both sync scanning and current-environment pruning',
  async (sandbox) => {
    await seedCurrentEnvironment(sandbox);
    const obsolete = join(sandbox, '.mev/roles/obsolete/config');
    await mkdir(join(obsolete, '..'), { recursive: true });
    await writeFile(obsolete, 'retained until ownership is available');
    const lease = await acquireMutationLease(sandbox, 'another sync');
    try {
      const result = await runSync(sandbox);
      expect(result.code).toBe(1);
      expect(result.stderr).toContain('another sync');
      expect(result.stdout).not.toContain('No targets need reapplying');
      expect(await Bun.file(obsolete).text()).toBe(
        'retained until ownership is available',
      );
    } finally {
      await lease.release();
    }
    const result = await runSync(sandbox);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('No targets need reapplying');
    expect(await Bun.file(obsolete).exists()).toBe(false);
  },
);
