import { CommandLineError } from '../errors';
import type { CommandRunner } from '../host/command';
import type { IdentityScope } from '../identity/scope';
import {
  type Identity,
  type IdentityState,
  identityFilePath,
  loadState,
  makeIdentity,
  saveState,
  stateExists,
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
  readonly personal: Identity | null;
  readonly work: Identity | null;
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
  const path = identityFilePath(deps.home);
  if (!stateExists(path)) return { personal: null, work: null };
  return loadState(path);
}

/** Stored identities plus the identity Git currently has applied globally. */
export async function showIdentity(deps: IdentityDeps): Promise<IdentityView> {
  const path = identityFilePath(deps.home);
  if (!stateExists(path)) {
    throw new CommandLineError(
      "No identity configuration found. Run 'mev user set' to configure.",
    );
  }
  const state = await loadState(path);
  return {
    path,
    personal: state.personal,
    work: state.work,
    current: await readCurrent(deps.run, state),
  };
}

/** Persist the given identities, replacing any existing configuration. */
export async function setIdentity(
  deps: { readonly home: string },
  inputs: { readonly personal: IdentityInput; readonly work: IdentityInput },
): Promise<{ readonly path: string; readonly state: IdentityState }> {
  const state: IdentityState = {
    personal: makeIdentity(inputs.personal.name, inputs.personal.email),
    work: makeIdentity(inputs.work.name, inputs.work.email),
  };
  const path = identityFilePath(deps.home);
  await saveState(path, state);
  return { path, state };
}

/** Apply a stored identity to the global Git config. */
export async function switchIdentity(
  deps: IdentityDeps,
  scope: IdentityScope,
): Promise<Identity> {
  const path = identityFilePath(deps.home);
  if (!stateExists(path)) {
    throw new CommandLineError(
      "No identity configuration found. Run 'mev user set' first to configure identities.",
    );
  }

  const state = await loadState(path);
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
  for (const scope of ['personal', 'work'] as const) {
    const stored = state[scope];
    if (stored && stored.name === name && stored.email === email) {
      return { kind: 'matched', scope, identity };
    }
  }
  return { kind: 'unmanaged', identity };
}
