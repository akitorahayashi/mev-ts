import { runWithCleanup } from '../host/cleanup-error';
import { acquireMutationLease } from '../host/mutation-lease';

export async function withHomeMutation<T>(
  home: string,
  operation: string,
  body: () => Promise<T>,
): Promise<T> {
  const lease = await acquireMutationLease(home, operation);
  return runWithCleanup(
    body,
    () => lease.release(),
    `Failed to release ${operation} mutation lease.`,
  );
}
