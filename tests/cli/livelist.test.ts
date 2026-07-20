import { expect, test } from 'bun:test';
import { renderLiveList } from '../../src/cli/tty/livelist';
import { AppError } from '../../src/errors';

// listr2 renders to stdout/stderr; swallow that so the live UI never
// contaminates the test runner output.
async function quietly<T>(fn: () => Promise<T>): Promise<T> {
  const originalOut = process.stdout.write;
  const originalErr = process.stderr.write;
  process.stdout.write = (() => true) as typeof process.stdout.write;
  process.stderr.write = (() => true) as typeof process.stderr.write;
  try {
    return await fn();
  } finally {
    process.stdout.write = originalOut;
    process.stderr.write = originalErr;
  }
}

test('renderLiveList runs every item and aggregates failures into one AppError', async () => {
  const ran: string[] = [];
  const items = [
    {
      label: 'ok-1',
      run: async () => {
        ran.push('ok-1');
      },
    },
    {
      label: 'bad',
      run: async () => {
        ran.push('bad');
        throw new Error('boom');
      },
    },
    {
      label: 'ok-2',
      run: async () => {
        ran.push('ok-2');
      },
    },
  ];

  const error = await quietly(() =>
    renderLiveList(items, { concurrency: 1 }).then(
      () => null,
      (e) => e,
    ),
  );

  expect(error).toBeInstanceOf(AppError);
  expect((error as AppError).message).toContain('bad: boom');
  // Failure isolation: the sibling items still ran.
  expect(ran).toContain('ok-1');
  expect(ran).toContain('ok-2');
});

test('renderLiveList resolves when every item succeeds', async () => {
  const items = [
    { label: 'a', run: async () => {} },
    { label: 'b', run: async () => {} },
  ];
  await quietly(() => renderLiveList(items, { concurrency: 1 }));
});
