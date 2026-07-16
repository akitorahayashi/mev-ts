import { expect, test } from 'bun:test';
import { CommandLineError } from '../../errors';
import type { CommandRunner } from '../../host/command';
import { deleteBranches } from './branches';

const dummyRunner: CommandRunner = {
  async run() {
    throw new Error('CommandRunner should not be called');
  },
};

test('rejects an empty branch list', async () => {
  await expect(deleteBranches(dummyRunner, [])).rejects.toBeInstanceOf(
    CommandLineError,
  );
});

test("rejects a '--' token before running any command", async () => {
  await expect(
    deleteBranches(dummyRunner, ['feature/a', '--', 'dev']),
  ).rejects.toThrow("'--' is not supported");
});

test('rejects --to without a branch name', async () => {
  await expect(
    deleteBranches(dummyRunner, ['feature/a', '--to']),
  ).rejects.toThrow('--to requires a branch name.');
});

test('rejects a second destination', async () => {
  await expect(
    deleteBranches(dummyRunner, ['feature/a', '--to', 'dev', '-t', 'other']),
  ).rejects.toThrow('The destination may be specified only once.');
});

test('rejects a destination-only invocation', async () => {
  await expect(
    deleteBranches(dummyRunner, ['--to', 'dev']),
  ).rejects.toBeInstanceOf(CommandLineError);
});
