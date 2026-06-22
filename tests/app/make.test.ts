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

test('plan lists the git feature resources without applying', async () => {
  const context = contextFor(sandbox, 1);
  const result = await runMake(
    { tags: ['git'], plan: true, overwrite: false },
    context,
  );

  expect(result.failed).toBe(false);
  expect(result.report).toContain('brew:formula:git');
  expect(result.report).toContain('git:config:global:core.excludesfile');
  expect(result.report).toContain('to change');
});

test('apply provisions the git feature through the full pipeline', async () => {
  const context = contextFor(sandbox, 0);
  const result = await runMake(
    { tags: ['git'], plan: false, overwrite: false },
    context,
  );

  expect(result.failed).toBe(false);
  expect(result.report).toContain('changed');
});

test('an unknown tag is rejected', async () => {
  const context = contextFor(sandbox, 0);
  await expect(
    runMake({ tags: ['nope'], plan: true, overwrite: false }, context),
  ).rejects.toBeInstanceOf(CommandLineError);
});
