import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { runMake } from '../../src/mev/app/make';
import { CommandLineError } from '../../src/mev/errors';
import type { Context } from '../../src/mev/resources/model';

let counter = 0;
let sandbox: string;

function contextFor(homeDir: string, code: number, stdout = ''): Context {
  return {
    home: homeDir,
    overwrite: false,
    commands: {
      async run() {
        return { code, stdout, stderr: '' };
      },
    },
    assets: {
      async read(key) {
        return `content of ${key}\n`;
      },
    },
  };
}

beforeEach(async () => {
  counter += 1;
  sandbox = join(process.cwd(), '.tmp', `make-${process.pid}-${counter}`);
  await mkdir(sandbox, { recursive: true });
});

afterEach(async () => {
  await rm(sandbox, { force: true, recursive: true });
});

test('plan lists the git target resources without applying', async () => {
  const context = contextFor(sandbox, 1);
  const result = await runMake(
    { tags: ['git'], plan: true, overwrite: false },
    context,
  );

  const ids = result.reports.map((r) => r.id);
  expect(result.failed).toBe(false);
  expect(ids).toContain('brew:formula:git');
  expect(ids.some((id) => id.includes('core.excludesfile'))).toBe(true);
  expect(result.reports.some((r) => r.outcome === 'changed')).toBe(true);
});

test('apply provisions the git target through the full pipeline', async () => {
  const context = contextFor(sandbox, 0);
  const result = await runMake(
    { tags: ['git'], plan: false, overwrite: false },
    context,
  );

  expect(result.failed).toBe(false);
  expect(result.reports.some((r) => r.outcome === 'changed')).toBe(true);
});

test('an unknown tag is rejected', async () => {
  const context = contextFor(sandbox, 0);
  await expect(
    runMake({ tags: ['nope'], plan: true, overwrite: false }, context),
  ).rejects.toBeInstanceOf(CommandLineError);
});

test('onStart fires with the total resource count', async () => {
  const context = contextFor(sandbox, 0);
  let total = -1;
  await runMake(
    {
      tags: ['git'],
      plan: true,
      overwrite: false,
      onStart: (n) => {
        total = n;
      },
    },
    context,
  );
  expect(total).toBeGreaterThan(0);
});

test('onProgress fires once per resource', async () => {
  const context = contextFor(sandbox, 0);
  let count = 0;
  const result = await runMake(
    {
      tags: ['git'],
      plan: false,
      overwrite: false,
      onProgress: () => {
        count += 1;
      },
    },
    context,
  );
  expect(count).toBe(result.reports.length);
});
