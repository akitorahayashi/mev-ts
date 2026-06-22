/**
 * Core provisioning resource model.
 *
 * A resource declares a single desired end state. It inspects the live host to
 * decide whether a change is needed, and applies only when it is. Execution
 * order and exclusion are derived from `dependencies` and `concurrencyGroup`.
 */

export interface CommandResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface CommandRunner {
  run(command: string, args: readonly string[]): Promise<CommandResult>;
}

export interface AssetSource {
  read(key: string): Promise<string>;
}

export interface Context {
  readonly home: string;
  readonly overwrite: boolean;
  readonly commands: CommandRunner;
  readonly assets: AssetSource;
}

/**
 * Maximum number of resources that may apply concurrently per group. A live
 * management surface that is unsafe to drive in parallel (Homebrew, git config)
 * is pinned to one; independent surfaces run wider.
 */
export const concurrencyGroups = {
  homebrew: 1,
  git: 1,
  filesystem: 8,
} as const;

export type ConcurrencyGroup = keyof typeof concurrencyGroups;

export type StateKind = 'present' | 'missing' | 'diverged';

export interface ResourceState {
  readonly kind: StateKind;
  readonly detail?: string;
}

export interface ApplyResult {
  readonly detail?: string;
}

export interface Resource {
  readonly id: string;
  readonly dependencies: readonly string[];
  readonly concurrencyGroup: ConcurrencyGroup;
  inspect(context: Context): Promise<ResourceState>;
  apply(context: Context): Promise<ApplyResult>;
}

export type Outcome = 'unchanged' | 'changed' | 'failed' | 'blocked';

export interface ResourceReport {
  readonly id: string;
  readonly outcome: Outcome;
  readonly detail?: string;
  readonly error?: string;
}
