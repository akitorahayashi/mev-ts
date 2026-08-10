import { AppError } from '../errors';

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
  // Once one mapper rejects, `Promise.all` has already settled on that error, so
  // continuing to dispatch would run work whose result nobody reads — and, for a
  // mapper with host effects, would keep mutating past the failure.
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
  await Promise.all(workers);
  return results;
}
