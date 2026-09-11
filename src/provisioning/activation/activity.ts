import type { ActivationActivity } from './contract';

class ActivityObserverError extends Error {
  constructor(readonly original: unknown) {
    super('Activation activity observer failed.');
  }
}

export function reportActivity(
  observer: ((activity: ActivationActivity) => void) | undefined,
  activity: ActivationActivity,
): void {
  try {
    observer?.(activity);
  } catch (error) {
    throw new ActivityObserverError(error);
  }
}

export function rethrowActivityObserverError(error: unknown): void {
  if (error instanceof ActivityObserverError) throw error.original;
}
