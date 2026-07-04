export function attachCleanupError(primary: Error, cleanup: unknown): Error {
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
