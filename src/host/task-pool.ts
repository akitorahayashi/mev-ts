import { AppError } from '../errors';

export async function drainAll<T>(
  promises: readonly Promise<T>[],
): Promise<T[]> {
  let failed = false;
  let firstFailure: unknown;
  const results = await Promise.all(
    promises.map((promise) =>
      promise.catch((error: unknown) => {
        if (!failed) firstFailure = error;
        failed = true;
      }),
    ),
  );
  if (failed) throw firstFailure;
  return results as T[];
}

export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new AppError('concurrency limit must be a positive integer.');
  }
  const results = new Array<R>(items.length);
  let next = 0;
  let failed = false;

  async function worker(): Promise<void> {
    while (!failed && next < items.length) {
      const index = next;
      next += 1;
      try {
        results[index] = await mapper(items[index] as T, index);
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () =>
    worker(),
  );
  await drainAll(workers);
  return results;
}
