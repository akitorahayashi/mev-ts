import { expect, test } from 'bun:test';
import { CommandLineError } from '../../errors';
import type { CommandRunner } from '../../host/command';
import { cloneRepositories } from './clone';

test('rejects an empty url list', async () => {
  const dummyRunner: CommandRunner = {
    async run() {
      throw new Error('CommandRunner should not be called');
    },
  };

  await expect(cloneRepositories(dummyRunner, [])).rejects.toBeInstanceOf(
    CommandLineError,
  );
});

test('rejects when only flags are supplied', async () => {
  const dummyRunner: CommandRunner = {
    async run() {
      throw new Error('CommandRunner should not be called');
    },
  };

  await expect(
    cloneRepositories(dummyRunner, ['--', '--depth', '1']),
  ).rejects.toBeInstanceOf(CommandLineError);
});
