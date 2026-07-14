import { homedir } from 'node:os';
import { type AssetSource, embeddedAssets } from '../assets/registry';
import { ProvisioningError } from '../errors';
import { bunCommandRunner, type CommandRunner } from './command';

/** Live execution context bound to the current user's environment. */
export interface Context {
  readonly home: string;
  readonly overwrite: boolean;
  readonly commands: CommandRunner;
  readonly assets: AssetSource;
  /** The inherited PATH, captured once so command steps stay PATH-testable. */
  readonly basePath: string;
}

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
    // The one place mev reads the ambient PATH; the empty-string fallback is the
    // documented default when PATH is unset.
    basePath: process.env.PATH ?? '',
  };
}
