import { AppError, CommandLineError } from '../errors';
import type { CommandRunner } from '../host/command';
import { allScopes, type IdentityScope } from '../identity/scope';
import {
  emptyState,
  type Identity,
  type IdentityState,
  identityFilePath,
  readState,
  saveState,
} from '../identity/store';
import { configGet, configSetGlobal } from '../internal/git/config';

export interface IdentityDeps {
  readonly run: CommandRunner;
  readonly home: string;
}

/** The Git identity currently applied to the global config, classified
 * against the stored profiles so callers can show which scope is active. */
export type CurrentIdentity =
  | {
      readonly kind: 'matched';
      readonly scope: IdentityScope;
      readonly identity: Identity;
    }
  | { readonly kind: 'unmanaged'; readonly identity: Identity }
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

/** Load stored identities, or an empty state when none are configured yet. */
export async function loadIdentities(deps: {
  readonly home: string;
}): Promise<IdentityState> {
  const state = await readState(identityFilePath(deps.home));
  return state ?? emptyState();
}

/** Stored identities plus the identity Git currently has applied globally. */
export async function showIdentity(deps: IdentityDeps): Promise<IdentityView> {
  const path = identityFilePath(deps.home);
  const state = await readState(path);
  if (state === null) {
    throw new CommandLineError(
      "No identity configuration found. Run 'mev user set' to configure.",
    );
  }
  return {
    path,
    identities: state,
    current: await readCurrent(deps.run, state),
  };
}

/** Persist the given identities, replacing any existing configuration. */
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

/** Apply a stored identity to the global Git config. */
export async function switchIdentity(
  deps: IdentityDeps,
  scope: IdentityScope,
): Promise<Identity> {
  const state = await readState(identityFilePath(deps.home));
  if (state === null) {
    throw new CommandLineError(
      "No identity configuration found. Run 'mev user set' first to configure identities.",
    );
  }

  const identity = state[scope];
  if (!identity) {
    throw new CommandLineError(
      `${scope} identity is not configured. Run 'mev user set' to configure.`,
    );
  }

  await configSetGlobal(deps.run, 'user.name', identity.name);
  await configSetGlobal(deps.run, 'user.email', identity.email);
  return identity;
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
  const name = input.name.trim();
  const email = input.email.trim();
  if (name === '' && email === '') return null;
  if (name === '' || email === '') {
    throw new AppError(
      `The ${scope} identity needs both a name and an email; leave both blank to clear it.`,
    );
  }
  return { name, email };
}

async function readCurrent(
  run: CommandRunner,
  state: IdentityState,
): Promise<CurrentIdentity> {
  const name = (await configGet(run, 'user.name')) ?? '';
  const email = (await configGet(run, 'user.email')) ?? '';
  // Only a fully blank config is "unset". A half-configured identity is a real
  // state worth surfacing, so it falls through as unmanaged rather than hiding.
  if (name === '' && email === '') return { kind: 'unset' };

  const identity = { name, email };
  for (const scope of allScopes()) {
    const stored = state[scope];
    if (stored && stored.name === name && stored.email === email) {
      return { kind: 'matched', scope, identity };
    }
  }
  return { kind: 'unmanaged', identity };
}
