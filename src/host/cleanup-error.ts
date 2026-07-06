function attachCleanupError(primary: Error, cleanup: unknown): Error {
  Object.defineProperty(primary, 'cleanupError', {
    configurable: true,
    enumerable: true,
    value: cleanup,
  });
  return primary;
}

export function throwWithCleanupError(
  primary: unknown,
  cleanup: unknown,
  message: string,
): never {
  if (primary instanceof Error) {
    throw attachCleanupError(primary, cleanup);
  }
  throw new AggregateError([primary, cleanup], message);
}

/**
 * Runs `action` then always runs `cleanup`, preserving error precedence: an
 * `action` failure wins and, if `cleanup` also fails, the cleanup error is
 * attached to it; a cleanup-only failure throws on its own; otherwise the
 * action's result is returned. `label` describes the cleanup step for the
 * AggregateError raised when the primary failure is not an `Error`.
 */
export async function runWithCleanup<T>(
  action: () => Promise<T>,
  cleanup: () => Promise<void>,
  label: string,
): Promise<T> {
  let outcome: { ok: true; value: T } | { ok: false; error: unknown };
  try {
    outcome = { ok: true, value: await action() };
  } catch (error) {
    outcome = { ok: false, error };
  }

  try {
    await cleanup();
  } catch (cleanupError) {
    if (!outcome.ok) {
      throwWithCleanupError(outcome.error, cleanupError, label);
    }
    throw cleanupError;
  }

  if (!outcome.ok) throw outcome.error;
  return outcome.value;
}
