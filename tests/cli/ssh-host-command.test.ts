import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { embeddedAssets } from '../../src/assets/registry';
import { sshHostPath } from '../../src/github/ssh-host';
import { appliedPath, writeApplied } from '../../src/provisioning/applied';
import { deployRole } from '../../src/provisioning/deploy';
import { allTargets } from '../../src/provisioning/registry';
import { isScanError, scanTargets } from '../../src/provisioning/scan';
import { targetSignature } from '../../src/provisioning/signature';
import { groveTarget } from '../../src/provisioning/targets/grove';
import { recordingContext } from '../fixtures/fake-context';
import { runCliInSandbox } from '../fixtures/sandboxed-cli';
import { sandboxedTest } from '../fixtures/temporary-directory';

const sandboxTest = sandboxedTest('ssh-host-command-');

sandboxTest('config ssh-host stores the positional SSH host', async (home) => {
  const result = await runCliInSandbox(
    ['config', 'ssh-host', 'github-work'],
    home,
  );

  expect(result.code).toBe(0);
  expect(result.stderr).toBe('');
  expect(result.stdout).toContain(sshHostPath(home));
  expect(await readFile(sshHostPath(home), 'utf8')).toBe('github-work\n');
});

sandboxTest('config ssh-host rejects unsafe aliases', async (home) => {
  const marker = appliedPath(home, groveTarget.name);
  const signature = `sha256:${'0'.repeat(64)}`;
  await writeApplied(marker, signature);
  const result = await runCliInSandbox(['cf', 'sh', 'git@github.com'], home);

  expect(result.code).toBe(1);
  expect(result.stderr).toContain('SSH host');
  expect(await readFile(marker, 'utf8')).toBe(`${signature}\n`);
});

sandboxTest(
  'changing the SSH host makes an applied Grove target stale',
  async (home) => {
    const context = recordingContext({
      home,
      assets: embeddedAssets,
    }).context;
    await deployRole(groveTarget.role, context);
    await writeApplied(
      appliedPath(home, groveTarget.name),
      await targetSignature(groveTarget, embeddedAssets),
    );
    const [before] = await scanTargets([groveTarget], context);
    expect(before && !isScanError(before) ? before.reasons : null).toEqual([]);

    const result = await runCliInSandbox(
      ['config', 'ssh-host', 'github-work'],
      home,
    );

    expect(result.code).toBe(0);
    expect(result.stderr).toBe('');

    const [after] = await scanTargets([groveTarget], context);
    expect(after && !isScanError(after) ? after.reasons : null).toEqual([
      'unapplied',
    ]);
  },
);

test('the targets invalidated by an SSH host change are the ones declaring it', () => {
  // Derived from the registry, not restated: a target that starts baking the
  // host in declares it and joins the invalidation set without touching
  // `configureSshHost`.
  const declaring = allTargets().filter((target) =>
    target.perMachineInputs.includes('githubSshHost'),
  );

  expect(declaring.map((target) => target.name)).toContain(groveTarget.name);
  // Agent plugins read the host live through `sshRemoteUrl` on every run and
  // deliberately keep it out of the signature, so they are never stale for it.
  expect(declaring.map((target) => target.name)).not.toContain('coder');
});
