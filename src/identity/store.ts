import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AppError } from '../errors';
import { writeFileAtomically } from '../host/atomic-file';

/** A name/email pair applied to global Git configuration. */
export interface Identity {
  readonly name: string;
  readonly email: string;
}

/** The persisted set of identities mev can switch between. */
export interface IdentityState {
  readonly personal: Identity | null;
  readonly work: Identity | null;
}

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

export function stateExists(path: string): boolean {
  return existsSync(path);
}

export async function loadState(path: string): Promise<IdentityState> {
  let content: string;
  try {
    content = await readFile(path, 'utf8');
  } catch (error) {
    const code =
      error instanceof Error ? (error as { code?: string }).code : undefined;
    if (code === 'ENOENT') {
      throw new AppError('identity configuration does not exist');
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new AppError(`failed to read identity config: ${message}`);
  }

  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new AppError(`failed to parse identity config: ${message}`);
  }

  return {
    personal: readIdentity(raw, 'personal'),
    work: readIdentity(raw, 'work'),
  };
}

/** Persist state via atomic temp-write + rename. */
export async function saveState(
  path: string,
  state: IdentityState,
): Promise<void> {
  const content = `${JSON.stringify(serialize(state), null, 2)}\n`;
  await writeFileAtomically(path, content);
}

function readIdentity(raw: unknown, key: 'personal' | 'work'): Identity | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const entry = (raw as Record<string, unknown>)[key];
  if (typeof entry !== 'object' || entry === null) return null;
  const { name, email } = entry as Record<string, unknown>;
  if (typeof name !== 'string' || typeof email !== 'string') return null;
  return makeIdentity(name, email);
}

function serialize(state: IdentityState): Record<string, Identity> {
  const out: Record<string, Identity> = {};
  if (state.personal) out.personal = state.personal;
  if (state.work) out.work = state.work;
  return out;
}
