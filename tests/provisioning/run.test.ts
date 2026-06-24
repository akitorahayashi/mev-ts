import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { deployedDir } from '../../src/assets/ref';
import { embeddedAssets } from '../../src/assets/registry';
import { CommandLineError } from '../../src/errors';
import type { Context } from '../../src/host/context';
import { runMake } from '../../src/provisioning/run';

let counter = 0;
let sandbox: string;

// Real embedded assets, sandboxed home, and a brew runner pinned to "present"
// so the run exercises deploy + activation without touching Homebrew.
function contextFor(homeDir: string, overwrite = false): Context {
  return {
    home: homeDir,
    overwrite,
    commands: {
      async run() {
        return { code: 0, stdout: '', stderr: '' };
      },
    },
    assets: embeddedAssets,
  };
}

function gitGroup(report: Awaited<ReturnType<typeof runMake>>) {
  return report.groups.find((g) => g.tag === 'git');
}

beforeEach(async () => {
  counter += 1;
  sandbox = join(process.cwd(), '.tmp', `run-${process.pid}-${counter}`);
  await mkdir(sandbox, { recursive: true });
});

afterEach(async () => {
  await rm(sandbox, { force: true, recursive: true });
});

test('an unknown tag is rejected', async () => {
  await expect(
    runMake(
      { tags: ['nope'], plan: true, overwrite: false },
      contextFor(sandbox),
    ),
  ).rejects.toBeInstanceOf(CommandLineError);
});

test('plan reports would-change without writing to the store', async () => {
  const report = await runMake(
    { tags: ['git'], plan: true, overwrite: false },
    contextFor(sandbox),
  );

  expect(report.failed).toBe(false);
  expect(report.selection.packages.formulae).toContain('git');
  expect(gitGroup(report)?.reports.every((r) => r.status === 'changed')).toBe(
    true,
  );
  await expect(Bun.file(deployedDir('git', sandbox)).stat()).rejects.toThrow();
});

test('apply deploys and links the git target', async () => {
  const report = await runMake(
    { tags: ['git'], plan: false, overwrite: false },
    contextFor(sandbox),
  );

  expect(report.failed).toBe(false);
  expect(report.deploys.some((d) => d.role === 'git' && d.deployed)).toBe(true);
  expect(gitGroup(report)?.reports.every((r) => r.status === 'changed')).toBe(
    true,
  );
});

test('an alias and its tag select the same target once', async () => {
  const report = await runMake(
    { tags: ['sh', 'shell'], plan: true, overwrite: false },
    contextFor(sandbox),
  );
  expect(report.selection.tags).toEqual(['shell']);
});

test('onDeploy fires for each role and onInstallStart reports formula count', async () => {
  const deployed: string[] = [];
  let installTotal = -1;
  await runMake(
    {
      tags: ['git'],
      plan: false,
      overwrite: false,
      onDeploy: (r) => deployed.push(r.role),
      onInstallStart: (n) => {
        installTotal = n;
      },
    },
    contextFor(sandbox),
  );
  expect(deployed).toEqual(['git']);
  expect(installTotal).toBe(1);
});
