import { join } from 'node:path';
import { AppError, errorMessage } from '../errors';
import { readTextIfPresent } from '../host/absence';
import { writeFileAtomically } from '../host/atomic-file';
import { isRecord } from '../host/parse';
import { mevRoot } from '../host/path';
import { allScopes, type IdentityScope } from './scope';

/** A name/email pair applied to global Git configuration. */
export interface Identity {
  readonly name: string;
  readonly email: string;
}

/** The persisted identities, one entry per scope (null when unconfigured). */
export type IdentityState = Record<IdentityScope, Identity | null>;

/** Build a validated identity, or null when either field is blank. */
export function makeIdentity(name: string, email: string): Identity | null {
  const trimmedName = name.trim();
  const trimmedEmail = email.trim();
  if (trimmedName === '' || trimmedEmail === '') return null;
  return { name: trimmedName, email: trimmedEmail };
}

/** Resolve `~/.mev/identity.json` under the given home directory. */
export function identityFilePath(home: string): string {
  return join(home, mevRoot, 'identity.json');
}

/** The state with every scope unconfigured. */
export function emptyState(): IdentityState {
  return Object.fromEntries(
    allScopes().map((scope) => [scope, null]),
  ) as IdentityState;
}

/**
 * Read the stored identities, or null when the file does not exist. One read
 * (through `readTextIfPresent`) replaces the former exists-then-read pair, so
 * there is no time-of-check/time-of-use gap and no sync filesystem probe.
 */
export async function readState(path: string): Promise<IdentityState | null> {
  const content = await readTextIfPresent(path);
  if (content === null) return null;

  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch (error) {
    throw new AppError(
      `failed to parse identity config: ${errorMessage(error)}`,
    );
  }

  if (!isRecord(raw)) {
    throw new AppError(`identity config at ${path} is not a JSON object.`);
  }

  return Object.fromEntries(
    allScopes().map((scope) => [scope, readIdentity(raw, scope, path)]),
  ) as IdentityState;
}

/** Persist state via atomic temp-write + rename. */
export async function saveState(
  path: string,
  state: IdentityState,
): Promise<void> {
  const content = `${JSON.stringify(serialize(state), null, 2)}\n`;
  await writeFileAtomically(path, content);
}

/**
 * Read one scope's identity. An absent scope (or an explicit null) is the
 * unconfigured state and yields null. A present-but-malformed entry — wrong
 * types, a non-object, or a blank name/email that `saveState` would never write
 * — is a corrupted-but-recoverable file, surfaced as an `AppError` rather than
 * silently read as null (which a later `saveState` would then delete).
 */
function readIdentity(
  raw: Record<string, unknown>,
  scope: IdentityScope,
  path: string,
): Identity | null {
  const entry = raw[scope];
  if (entry === undefined || entry === null) return null;
  if (!isRecord(entry)) {
    throw new AppError(
      `identity config at ${path} has a malformed '${scope}' entry: expected an object.`,
    );
  }
  const { name, email } = entry;
  if (typeof name !== 'string' || typeof email !== 'string') {
    throw new AppError(
      `identity config at ${path} has a malformed '${scope}' entry: 'name' and 'email' must be strings.`,
    );
  }
  const identity = makeIdentity(name, email);
  if (identity === null) {
    throw new AppError(
      `identity config at ${path} has a blank name or email in the '${scope}' entry.`,
    );
  }
  return identity;
}

function serialize(state: IdentityState): Record<string, Identity> {
  const out: Record<string, Identity> = {};
  for (const scope of allScopes()) {
    const identity = state[scope];
    if (identity) out[scope] = identity;
  }
  return out;
}
