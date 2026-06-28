import { expect, test } from 'bun:test';
import { CommandLineError } from '../../errors';
import type { CommandRunner } from '../../host/command';
import { deleteBranches } from './branches';

test('rejects an empty branch list', async () => {
  const dummyRunner: CommandRunner = {
    async run() {
      throw new Error('CommandRunner should not be called');
    },
  };

  await expect(deleteBranches(dummyRunner, [])).rejects.toBeInstanceOf(
    CommandLineError,
  );
});
