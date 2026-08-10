import { expect, test } from 'bun:test';
import { AppError } from '../errors';
import { mapWithConcurrency } from './task-pool';

test('mapWithConcurrency bounds active work and preserves input order', async () => {
  let active = 0;
  let maxActive = 0;
  const results = await mapWithConcurrency(
    [30, 10, 20, 0],
    2,
    async (delay, index) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await Bun.sleep(delay);
      active -= 1;
      return `item-${index}`;
    },
  );

  expect(maxActive).toBeLessThanOrEqual(2);
  expect(results).toEqual(['item-0', 'item-1', 'item-2', 'item-3']);
});

test('mapWithConcurrency stops dispatching new items after a rejection', async () => {
  const started: number[] = [];

  await expect(
    mapWithConcurrency([0, 1, 2, 3, 4, 5], 2, async (item) => {
      started.push(item);
      await Bun.sleep(1);
      if (item === 0) throw new AppError('mapper failed');
      return item;
    }),
  ).rejects.toThrow('mapper failed');

  // The two workers are in flight when the first rejects; neither picks up
  // another item afterwards.
  expect(started).toEqual([0, 1]);
});

test('mapWithConcurrency rejects invalid limits', async () => {
  await expect(
    mapWithConcurrency([1], 0, async (value) => value),
  ).rejects.toBeInstanceOf(AppError);
});
