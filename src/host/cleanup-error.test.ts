import { expect, test } from 'bun:test';
import { runWithCleanup, throwWithCleanupError } from './cleanup-error';

test('runWithCleanup returns the action value after running cleanup', async () => {
  const order: string[] = [];
  const result = await runWithCleanup(
    async () => {
      order.push('action');
      return 42;
    },
    async () => {
      order.push('cleanup');
    },
    'label',
  );

  expect(result).toBe(42);
  expect(order).toEqual(['action', 'cleanup']);
});

test('runWithCleanup throws the cleanup failure when the action succeeded', async () => {
  const cleanupError = new Error('cleanup failed');
  await expect(
    runWithCleanup(
      async () => 1,
      async () => {
        throw cleanupError;
      },
      'label',
    ),
  ).rejects.toBe(cleanupError);
});

test('runWithCleanup propagates the action failure and still runs cleanup', async () => {
  const actionError = new Error('action failed');
  let cleaned = false;
  await expect(
    runWithCleanup(
      async () => {
        throw actionError;
      },
      async () => {
        cleaned = true;
      },
      'label',
    ),
  ).rejects.toBe(actionError);
  expect(cleaned).toBe(true);
});

test('runWithCleanup attaches the cleanup error to an Error action failure', async () => {
  const actionError = new Error('action failed');
  const cleanupError = new Error('cleanup failed');
  let caught: unknown;
  try {
    await runWithCleanup(
      async () => {
        throw actionError;
      },
      async () => {
        throw cleanupError;
      },
      'label',
    );
  } catch (error) {
    caught = error;
  }

  expect(caught).toBe(actionError);
  expect((caught as Error & { cleanupError?: unknown }).cleanupError).toBe(
    cleanupError,
  );
  expect(Object.keys(actionError)).toContain('cleanupError');
});

test('runWithCleanup combines a non-Error action failure with the cleanup error', async () => {
  const cleanupError = new Error('cleanup failed');
  let caught: unknown;
  try {
    await runWithCleanup(
      async () => {
        throw 'string failure';
      },
      async () => {
        throw cleanupError;
      },
      'combine label',
    );
  } catch (error) {
    caught = error;
  }

  expect(caught).toBeInstanceOf(AggregateError);
  const aggregate = caught as AggregateError;
  expect(aggregate.errors).toEqual(['string failure', cleanupError]);
  expect(aggregate.message).toBe('combine label');
});

test('throwWithCleanupError attaches cleanup as an enumerable property of an Error primary', () => {
  const primary = new Error('primary');
  const cleanup = new Error('cleanup');

  let caught: unknown;
  try {
    throwWithCleanupError(primary, cleanup, 'label');
  } catch (error) {
    caught = error;
  }

  expect(caught).toBe(primary);
  expect((caught as Error & { cleanupError?: unknown }).cleanupError).toBe(
    cleanup,
  );
  expect(Object.keys(primary)).toContain('cleanupError');
});

test('throwWithCleanupError wraps a non-Error primary in a labeled AggregateError', () => {
  let caught: unknown;
  try {
    throwWithCleanupError(123, 'cleanup-info', 'the label');
  } catch (error) {
    caught = error;
  }

  expect(caught).toBeInstanceOf(AggregateError);
  const aggregate = caught as AggregateError;
  expect(aggregate.errors).toEqual([123, 'cleanup-info']);
  expect(aggregate.message).toBe('the label');
});
