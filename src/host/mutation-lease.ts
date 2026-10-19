import { randomUUID } from 'node:crypto';
import {
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  rmdir,
  writeFile,
} from 'node:fs/promises';
import { hostname } from 'node:os';
import { dirname, join } from 'node:path';
import { errorMessage, ProvisioningError } from '../errors';
import { runWithCleanup } from './cleanup-error';
import { mevPath, resolveHostPath } from './path';

interface Owner {
  readonly version: 1;
  readonly host: string;
  readonly pid: number;
  readonly token: string;
  readonly operation: string;
}

export interface MutationLease {
  release(): Promise<void>;
}

export function mutationLeasePath(home: string): string {
  return resolveHostPath(mevPath('mutation-lease'), home);
}

function ownershipFailure(path: string, detail: string): ProvisioningError {
  return new ProvisioningError(
    `Cannot acquire mutation lease at ${path}: ${detail}. Retained state requires inspection; no lease was discarded.`,
  );
}

async function readOwner(path: string): Promise<Owner> {
  try {
    const [directory, metadata] = await Promise.all([
      lstat(path),
      lstat(join(path, 'owner.json')),
    ]);
    if (
      !directory.isDirectory() ||
      directory.isSymbolicLink() ||
      !metadata.isFile() ||
      metadata.isSymbolicLink()
    ) {
      throw new Error('lease and owner metadata must be owned regular entries');
    }
    const value: unknown = JSON.parse(
      await readFile(join(path, 'owner.json'), 'utf8'),
    );
    if (value === null || typeof value !== 'object')
      throw new Error('expected owner metadata');
    const owner = value as Record<string, unknown>;
    if (
      Object.keys(owner).sort().join(',') !==
        'host,operation,pid,token,version' ||
      owner['version'] !== 1 ||
      typeof owner['host'] !== 'string' ||
      !owner['host'] ||
      !Number.isSafeInteger(owner['pid']) ||
      Number(owner['pid']) <= 0 ||
      typeof owner['token'] !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
        owner['token'],
      ) ||
      typeof owner['operation'] !== 'string' ||
      !owner['operation'].trim()
    ) {
      throw new Error('incomplete or unknown owner metadata');
    }
    return owner as unknown as Owner;
  } catch (error) {
    throw ownershipFailure(
      path,
      `ownership is unknown (${errorMessage(error)})`,
    );
  }
}

function ownerEnded(owner: Owner, path: string): boolean {
  if (owner.host !== hostname())
    throw ownershipFailure(path, `owner is on another host (${owner.host})`);
  try {
    process.kill(owner.pid, 0);
    return false;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return true;
    throw ownershipFailure(
      path,
      `owner liveness is inconclusive (${errorMessage(error)})`,
    );
  }
}

async function retire(
  path: string,
  owner: Owner,
  reclaim: boolean,
): Promise<void> {
  const claim = join(path, 'claim');
  try {
    await mkdir(claim, { mode: 0o700 });
  } catch (error) {
    throw ownershipFailure(
      path,
      `ownership transition for '${owner.operation}' is unavailable (${errorMessage(error)})`,
    );
  }
  let moved = false;
  await runWithCleanup(
    async () => {
      const current = await readOwner(path);
      if (
        current.token !== owner.token ||
        current.pid !== owner.pid ||
        current.host !== owner.host
      ) {
        throw ownershipFailure(path, 'ownership changed before release');
      }
      if (reclaim && !ownerEnded(current, path)) {
        throw ownershipFailure(
          path,
          `owner '${current.operation}' (pid ${current.pid}) is active`,
        );
      }
      const names = (await readdir(path)).sort();
      if (
        names.join(',') !== 'claim,owner.json' ||
        (await readdir(claim)).length !== 0
      ) {
        throw ownershipFailure(path, 'unexpected lease contents');
      }
      const retirement = await mkdtemp(
        join(dirname(path), '.mutation-retired-'),
      );
      await runWithCleanup(
        async () => {
          // The claim serializes transitions within this incarnation. A contender
          // that reaches a new incarnation must revalidate its recorded token.
          await rename(path, join(retirement, 'lease'));
          moved = true;
        },
        () => rm(retirement, { recursive: true }),
        `Failed to clean retired mutation lease at ${retirement}.`,
      );
    },
    async () => {
      if (!moved) await rmdir(claim);
    },
    `Failed to release ownership transition at ${path}.`,
  );
}

export async function acquireMutationLease(
  home: string,
  operation: string,
): Promise<MutationLease> {
  const path = mutationLeasePath(home);
  const owner: Owner = {
    version: 1,
    host: hostname(),
    pid: process.pid,
    token: randomUUID(),
    operation,
  };
  if (!operation.trim())
    throw new ProvisioningError('A mutation operation name is required.');
  try {
    await mkdir(dirname(path), { recursive: true });
  } catch (error) {
    throw ownershipFailure(path, errorMessage(error));
  }
  let acquired = false;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await mkdir(path, { mode: 0o700 });
      acquired = true;
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw ownershipFailure(path, errorMessage(error));
      }
      const existing = await readOwner(path);
      if (!ownerEnded(existing, path)) {
        throw new ProvisioningError(
          `Another mev mutation '${existing.operation}' (pid ${existing.pid}) owns ${path}. This invocation does not wait.`,
        );
      }
      if (attempt !== 0)
        throw ownershipFailure(
          path,
          'another ownership transition won acquisition',
        );
      await retire(path, existing, true);
    }
  }
  if (!acquired)
    throw ownershipFailure(path, 'acquisition did not establish ownership');
  try {
    await writeFile(join(path, 'owner.json'), `${JSON.stringify(owner)}\n`, {
      flag: 'wx',
      mode: 0o600,
    });
  } catch (error) {
    // Incomplete metadata remains visible; no invocation can prove it stale.
    throw ownershipFailure(
      path,
      `failed to publish owner metadata (${errorMessage(error)})`,
    );
  }
  let released = false;
  return {
    async release() {
      if (released) return;
      await retire(path, owner, false);
      released = true;
    },
  };
}
