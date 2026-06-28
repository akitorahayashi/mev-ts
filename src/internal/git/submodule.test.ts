import { expect, test } from 'bun:test';
import { CommandLineError } from '../../errors';
import type { CommandRunner } from '../../host/command';
import { deleteSubmodule } from './submodule';

test('rejects an absolute path', async () => {
  const dummyRunner: CommandRunner = {
    async run() {
      throw new Error('CommandRunner should not be called');
    },
  };
  await expect(
    deleteSubmodule(dummyRunner, ['/abs/path']),
  ).rejects.toBeInstanceOf(CommandLineError);
});

test('rejects parent traversal', async () => {
  const dummyRunner: CommandRunner = {
    async run() {
      throw new Error('CommandRunner should not be called');
    },
  };
  await expect(
    deleteSubmodule(dummyRunner, ['../escape']),
  ).rejects.toBeInstanceOf(CommandLineError);
});

test('rejects parent traversal hidden inside the path', async () => {
  const dummyRunner: CommandRunner = {
    async run() {
      throw new Error('CommandRunner should not be called');
    },
  };
  await expect(
    deleteSubmodule(dummyRunner, ['vendor/../escape']),
  ).rejects.toBeInstanceOf(CommandLineError);
});

test('rejects backslash-separated traversal', async () => {
  const dummyRunner: CommandRunner = {
    async run() {
      throw new Error('CommandRunner should not be called');
    },
  };
  await expect(
    deleteSubmodule(dummyRunner, ['vendor\\..\\escape']),
  ).rejects.toBeInstanceOf(CommandLineError);
});

test('rejects a current-directory segment', async () => {
  const dummyRunner: CommandRunner = {
    async run() {
      throw new Error('CommandRunner should not be called');
    },
  };
  await expect(
    deleteSubmodule(dummyRunner, ['./vendor/dep']),
  ).rejects.toBeInstanceOf(CommandLineError);
});

test('rejects an empty path', async () => {
  const dummyRunner: CommandRunner = {
    async run() {
      throw new Error('CommandRunner should not be called');
    },
  };
  await expect(deleteSubmodule(dummyRunner, [''])).rejects.toBeInstanceOf(
    CommandLineError,
  );
});

test('rejects more than one path', async () => {
  const dummyRunner: CommandRunner = {
    async run() {
      throw new Error('CommandRunner should not be called');
    },
  };
  await expect(deleteSubmodule(dummyRunner, ['a', 'b'])).rejects.toBeInstanceOf(
    CommandLineError,
  );
});
