import { expect } from 'bun:test';
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { AssetSource } from '../../src/assets/registry';
import type { Context } from '../../src/host/context';
import { appliedPath, writeApplied } from '../../src/provisioning/applied';
import { deployRole } from '../../src/provisioning/deploy';
import {
  isScanError,
  scanTargets,
  type TargetScan,
  type TargetScanResult,
} from '../../src/provisioning/scan';
import { targetSignature } from '../../src/provisioning/signature';
import { target } from '../../src/provisioning/target';
import { recordingContext } from '../fixtures/fake-context';
import { sandboxedTest } from '../fixtures/temporary-directory';

const sandboxTest = sandboxedTest('scan-');

function scanned(scan: TargetScan | undefined): TargetScanResult {
  if (!scan || isScanError(scan)) {
    throw new Error('expected a classified (non-error) scan');
  }
  return scan;
}

function assets(
  contents: Readonly<Record<string, string>>,
  executable: readonly string[] = [],
): AssetSource {
  const executableKeys = new Set(executable);
  return {
    async read(key) {
      const content = contents[key];
      if (content === undefined) throw new Error(`unknown asset ${key}`);
      return content;
    },
    keysByPrefix(prefix) {
      return Object.keys(contents).filter((key) => key.startsWith(prefix));
    },
    isExecutable(key) {
      return executableKeys.has(key);
    },
  };
}

function contextFor(home: string, source: AssetSource): Context {
  return recordingContext({ home, assets: source }).context;
}

const demoTarget = target('demo', {
  description: 'demo',
  role: 'demo',
  packages: { formulae: ['fd'] },
  activations: [],
});

sandboxTest(
  'missing state and deployed config select the target',
  async (home) => {
    const context = contextFor(home, assets({ 'demo/config': 'value\n' }));

    const [scan] = await scanTargets([demoTarget], context);

    expect(scanned(scan).reasons).toEqual(['unapplied', 'drift']);
  },
);

sandboxTest('matching applied and deployed state is current', async (home) => {
  const source = assets({ 'demo/script': '#!/bin/sh\n' }, ['demo/script']);
  const context = contextFor(home, source);
  await deployRole('demo', context);
  await writeApplied(
    appliedPath(home, demoTarget.name),
    await targetSignature(demoTarget, source),
  );

  const [scan] = await scanTargets([demoTarget], context);

  expect(scanned(scan).reasons).toEqual([]);
});

sandboxTest(
  'content, executable, and extra-path drift is detected',
  async (home) => {
    const source = assets({ 'demo/script': '#!/bin/sh\n' }, ['demo/script']);
    const context = contextFor(home, source);
    await deployRole('demo', context);
    await writeApplied(
      appliedPath(home, demoTarget.name),
      await targetSignature(demoTarget, source),
    );
    const script = join(home, '.mev/roles/demo/script');
    await writeFile(script, '#!/bin/sh\necho drift\n');
    await chmod(script, 0o644);
    const extra = join(home, '.mev/roles/demo/extra/file');
    await mkdir(dirname(extra), { recursive: true });
    await writeFile(extra, 'extra\n');

    const [scan] = await scanTargets([demoTarget], context);

    expect(scanned(scan).reasons).toEqual(['drift']);
  },
);

sandboxTest(
  'a package-only declaration change is detected by signature',
  async (home) => {
    const source = assets({});
    const context = contextFor(home, source);
    await writeApplied(
      appliedPath(home, demoTarget.name),
      await targetSignature(demoTarget, source),
    );
    const changed = target('demo', {
      description: 'demo',
      role: 'demo',
      packages: { formulae: ['fd', 'ripgrep'] },
      activations: [],
    });

    const [scan] = await scanTargets([changed], context);

    expect(scanned(scan).reasons).toEqual(['signature']);
  },
);

sandboxTest(
  'a single unreadable marker fails only its target, not the batch',
  async (home) => {
    const source = assets({ 'demo/config': 'value\n' });
    const context = contextFor(home, source);
    // Plant a malformed applied marker for `demo` so its scan throws while the
    // sibling target still classifies.
    const marker = appliedPath(home, demoTarget.name);
    await mkdir(dirname(marker), { recursive: true });
    await writeFile(marker, 'not-a-signature\n');
    const sibling = target('other', {
      description: 'other',
      role: 'other',
      packages: { formulae: [] },
      activations: [],
    });

    const [demoScan, otherScan] = await scanTargets(
      [demoTarget, sibling],
      context,
    );

    expect(demoScan && isScanError(demoScan)).toBe(true);
    if (demoScan && isScanError(demoScan)) {
      expect(demoScan.error).toContain('Malformed applied signature');
    }
    expect(scanned(otherScan).reasons).toContain('unapplied');
  },
);
