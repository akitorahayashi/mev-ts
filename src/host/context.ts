import { homedir } from 'node:os';
import { embeddedAssets } from '../assets/registry';
import { ProvisioningError } from '../errors';
import type { Context } from '../resources/model';
import { bunCommandRunner } from './command';

interface ContextOptions {
  readonly overwrite: boolean;
}

/** Resolve the current user's home directory or surface a typed failure. */
export function resolveHome(): string {
  const home = process.env.HOME ?? homedir();
  if (!home) {
    throw new ProvisioningError('Unable to resolve the home directory.');
  }
  return home;
}

/** Build the live execution context bound to the current user's environment. */
export function createContext(options: ContextOptions): Context {
  return {
    home: resolveHome(),
    overwrite: options.overwrite,
    commands: bunCommandRunner,
    assets: embeddedAssets,
  };
}
