import { join } from 'node:path';
import { AppError, errorMessage } from '../errors';
import { readTextIfPresent } from '../host/absence';
import { writeFileAtomically } from '../host/atomic-file';
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

/** Resolve `~/.config/mev/identity.json` under the given home directory. */
export function identityFilePath(home: string): string {
  return join(home, '.config', 'mev', 'identity.json');
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

  return Object.fromEntries(
    allScopes().map((scope) => [scope, readIdentity(raw, scope)]),
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

function readIdentity(raw: unknown, key: IdentityScope): Identity | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const entry = (raw as Record<string, unknown>)[key];
  if (typeof entry !== 'object' || entry === null) return null;
  const { name, email } = entry as Record<string, unknown>;
  if (typeof name !== 'string' || typeof email !== 'string') return null;
  return makeIdentity(name, email);
}

function serialize(state: IdentityState): Record<string, Identity> {
  const out: Record<string, Identity> = {};
  for (const scope of allScopes()) {
    const identity = state[scope];
    if (identity) out[scope] = identity;
  }
  return out;
}
