import { AppError } from '../errors';
import {
  configGet,
  configGetLocal,
  configSetFileValues,
  configSetLocalValues,
  configUnsetLocal,
} from '../git/config';
import { isInsideGitRepository } from '../git/repo';
import type { CommandRunner } from '../host/command';
import { identityOverlayPath } from '../identity/overlay';
import { allScopes, type IdentityScope } from '../identity/scope';
import {
  emptyState,
  type Identity,
  type IdentityState,
  identityFilePath,
  makeIdentity,
  readState,
  saveState,
} from '../identity/store';

export interface IdentityDeps {
  readonly run: CommandRunner;
  readonly home: string;
  readonly cwd: string;
}

export type IdentityOrigin = 'local' | 'global';

export type CurrentIdentity =
  | {
      readonly kind: 'matched';
      readonly scope: IdentityScope;
      readonly identity: Identity;
      readonly origin: IdentityOrigin;
    }
  | {
      readonly kind: 'unmanaged';
      readonly identity: Identity;
      readonly origin: IdentityOrigin;
    }
  | { readonly kind: 'unset' };

export interface IdentityView {
  readonly path: string;
  readonly identities: IdentityState;
  readonly current: CurrentIdentity;
}

export interface IdentityInput {
  readonly name: string;
  readonly email: string;
}

export async function loadIdentities(deps: {
  readonly home: string;
}): Promise<IdentityState> {
  const state = await readState(identityFilePath(deps.home));
  return state ?? emptyState();
}

export async function showIdentity(deps: IdentityDeps): Promise<IdentityView> {
  const path = identityFilePath(deps.home);
  const state = await readState(path);
  if (state === null) {
    throw new AppError(
      "No identity configuration found. Run 'mev user set' to configure.",
    );
  }
  return {
    path,
    identities: state,
    current: await readCurrent(deps, state),
  };
}

export async function setIdentity(
  deps: { readonly home: string },
  inputs: Record<IdentityScope, IdentityInput>,
): Promise<{ readonly path: string; readonly state: IdentityState }> {
  const state = Object.fromEntries(
    allScopes().map((scope) => [scope, resolveInput(scope, inputs[scope])]),
  ) as IdentityState;
  const path = identityFilePath(deps.home);
  await saveState(path, state);
  return { path, state };
}

export interface SwitchResult {
  readonly identity: Identity;
  /** The current repository pins its identity locally, shadowing this switch. */
  readonly locallyPinned: boolean;
}

export async function switchIdentity(
  deps: IdentityDeps,
  scope: IdentityScope,
): Promise<SwitchResult> {
  const identity = await resolveStoredIdentity(deps.home, scope);
  // The pin probe runs before the overlay write: it can fail on a broken
  // repository (e.g. dubious ownership), and failing after the write would
  // report an error for a switch that already happened.
  const locallyPinned = await hasLocalPin(deps);
  const overlay = identityOverlayPath(deps.home);
  await configSetFileValues(deps.run, overlay, [
    ['user.name', identity.name],
    ['user.email', identity.email],
  ]);
  return { identity, locallyPinned };
}

export async function pinIdentity(
  deps: IdentityDeps,
  scope: IdentityScope,
): Promise<Identity> {
  if (!(await isInsideGitRepository(deps.run, deps.cwd))) {
    throw new AppError(
      "Not inside a git repository. Run 'mev switch <scope>' without --write to switch globally, or run this inside a repository.",
    );
  }
  const identity = await resolveStoredIdentity(deps.home, scope);
  await configSetLocalValues(deps.run, deps.cwd, [
    ['user.name', identity.name],
    ['user.email', identity.email],
  ]);
  return identity;
}

export interface UnpinResult {
  readonly kind: 'unpinned' | 'already-global';
  readonly effective: CurrentIdentity;
}

export async function unpinIdentity(deps: IdentityDeps): Promise<UnpinResult> {
  if (!(await isInsideGitRepository(deps.run, deps.cwd))) {
    throw new AppError(
      'Not inside a git repository. --unset removes the pin of the repository you run it in.',
    );
  }
  const removedName = await configUnsetLocal(deps.run, deps.cwd, 'user.name');
  const removedEmail = await configUnsetLocal(deps.run, deps.cwd, 'user.email');
  const state = await loadIdentities(deps);
  return {
    kind: removedName || removedEmail ? 'unpinned' : 'already-global',
    effective: await readCurrent(deps, state),
  };
}

async function resolveStoredIdentity(
  home: string,
  scope: IdentityScope,
): Promise<Identity> {
  const state = await readState(identityFilePath(home));
  if (state === null) {
    throw new AppError(
      "No identity configuration found. Run 'mev user set' first to configure identities.",
    );
  }
  const identity = state[scope];
  if (!identity) {
    throw new AppError(
      `${scope} identity is not configured. Run 'mev user set' to configure.`,
    );
  }
  return identity;
}

async function hasLocalPin(deps: IdentityDeps): Promise<boolean> {
  if (!(await isInsideGitRepository(deps.run, deps.cwd))) return false;
  const [name, email] = await Promise.all([
    configGetLocal(deps.run, deps.cwd, 'user.name'),
    configGetLocal(deps.run, deps.cwd, 'user.email'),
  ]);
  return name !== null || email !== null;
}

/**
 * Turn one scope's prompt input into a stored identity. Both fields blank means
 * "leave the scope unset" (returns null). Exactly one blank is a mistake — the
 * user meant to configure the scope but left half of it empty — so it fails
 * loudly rather than silently storing the scope as absent.
 */
function resolveInput(
  scope: IdentityScope,
  input: IdentityInput,
): Identity | null {
  // Exactly one blank field is the only mistake this layer owns: the user meant
  // to configure the scope but left half of it empty. The both-blank (clear) and
  // fully-filled (valid) cases delegate to makeIdentity, the single source of
  // truth for identity validity.
  if ((input.name.trim() === '') !== (input.email.trim() === '')) {
    throw new AppError(
      `The ${scope} identity needs both a name and an email; leave both blank to clear it.`,
    );
  }
  return makeIdentity(input.name, input.email);
}

async function readCurrent(
  deps: IdentityDeps,
  state: IdentityState,
): Promise<CurrentIdentity> {
  const inRepo = await isInsideGitRepository(deps.run, deps.cwd);
  const [localName, localEmail] = inRepo
    ? await Promise.all([
        configGetLocal(deps.run, deps.cwd, 'user.name'),
        configGetLocal(deps.run, deps.cwd, 'user.email'),
      ])
    : [null, null];
  const [globalName, globalEmail] = await Promise.all([
    configGet(deps.run, 'user.name'),
    configGet(deps.run, 'user.email'),
  ]);
  const origin: IdentityOrigin =
    localName !== null || localEmail !== null ? 'local' : 'global';
  const name = localName ?? globalName ?? '';
  const email = localEmail ?? globalEmail ?? '';
  // Only a fully blank config is "unset". A half-configured identity is a real
  // state worth surfacing, so it falls through as unmanaged rather than hiding.
  if (name === '' && email === '') return { kind: 'unset' };

  const identity = { name, email };
  for (const scope of allScopes()) {
    const stored = state[scope];
    if (stored && stored.name === name && stored.email === email) {
      return { kind: 'matched', scope, identity, origin };
    }
  }
  return { kind: 'unmanaged', identity, origin };
}
