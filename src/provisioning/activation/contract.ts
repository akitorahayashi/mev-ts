import type { AssetRef } from '../../assets/ref';
import type { HostPath } from '../../host/path';

export type Verb = 'link' | 'apply' | 'run';

/**
 * How a `remoteInstaller` verifies the script it downloads before executing it.
 * A required discriminant, not an optional field: skipping verification must be a
 * loud, reviewed declaration (`acknowledgedUnverified`) rather than the easy
 * default of an absent checksum URL, per the no-silent-fallback rule.
 */
export type RemoteInstallerIntegrity =
  | { readonly checksumUrl: string }
  | { readonly acknowledgedUnverified: true };

/**
 * A single config materialization or host mutation. The union is the source of
 * truth for the activation vocabulary — every kind is dispatched exhaustively by
 * `runActivation` and `describeActivation`, and the multi-item kinds share the
 * `reconcile.ts` envelope. See the per-kind table in docs/architecture.md.
 */
export type Activation =
  | {
      readonly kind: 'file';
      readonly source: AssetRef;
      readonly dest: HostPath;
    }
  | {
      readonly kind: 'tree';
      readonly prefix: string;
      readonly dest: HostPath;
    }
  | {
      readonly kind: 'defaults';
      readonly configKey: string;
    }
  | {
      readonly kind: 'duti';
      readonly configKey: string;
    }
  | {
      readonly kind: 'pipx';
      readonly configKey: string;
    }
  | {
      readonly kind: 'editorExtensions';
      readonly command: string;
      readonly configKey: string;
    }
  | {
      readonly kind: 'coderAgents';
      readonly sectionsPrefix: string;
      readonly dests: readonly HostPath[];
    }
  | {
      readonly kind: 'coderSkills';
      readonly skillsPrefix: string;
      readonly targetDirs: readonly HostPath[];
    }
  | {
      readonly kind: 'zedSettings';
      readonly base: AssetRef;
      readonly overridesPrefix: string;
      readonly dest: HostPath;
    }
  | {
      readonly kind: 'command';
      readonly label: string;
      readonly reads?: Readonly<Record<string, CommandRead>>;
      readonly steps: readonly CommandStep[];
    }
  | {
      readonly kind: 'remoteInstaller';
      readonly label: string;
      readonly url: string;
      readonly integrity: RemoteInstallerIntegrity;
      readonly interpreter: 'bash' | 'sh' | 'direct';
      readonly args: readonly string[];
      readonly creates: HostPath;
      readonly env?: Readonly<Record<string, string>>;
      readonly pathPrefix?: readonly HostPath[];
    }
  | {
      readonly kind: 'release';
      readonly configKey: string;
    };

/**
 * The named values a command step resolves against at apply time: `home` and
 * `basePath` (the inherited `PATH`) as reserved host facts, plus every asset
 * declared in `reads` and the stdout of any prior `capture` step. Looking up an
 * absent name throws, so a missing capture fails loudly rather than rendering as
 * an `undefined` argument.
 */
export interface CommandScope {
  ref(name: string): string;
}

/**
 * A declarative argv token, resolved at apply time. Kept as data (not a thunk)
 * so the signature can hash it: an edit to the command structure flips the
 * signature without a manual counter. A bare string is a literal; `ref` is a
 * single scope value; `concat` joins its resolved parts into one argument; and
 * `splitRef` expands a whitespace-separated scope value into zero or more
 * arguments.
 */
export type CommandArg =
  | string
  | { readonly ref: string }
  | { readonly concat: readonly CommandArg[] }
  | { readonly splitRef: string };

/**
 * A declarative environment value. `pathList` resolves each segment, drops the
 * empty ones, and joins with `:` — the PATH-composition shape — so an absent
 * inherited PATH leaves no trailing separator.
 */
export type CommandEnvValue =
  | string
  | { readonly ref: string }
  | { readonly concat: readonly CommandArg[] }
  | { readonly pathList: readonly CommandArg[] };

/**
 * A named asset read for a command activation. A bare string is the asset key.
 * The object form adds one of: `validate`, a throwing-only guard over the
 * trimmed value exactly as it will be bound (its `void` return cannot transform
 * the binding); or `derive`, which maps the raw asset content to the bound value
 * (throwing to reject), for a read whose bound form is a transform of the file.
 */
export type CommandRead =
  | string
  | {
      readonly key: string;
      readonly validate: (value: string, path: string) => void;
    }
  | { readonly key: string; readonly derive: (raw: string) => string };

export type StepGuard =
  | { readonly pathExists: CommandArg }
  | { readonly commandSucceeds: readonly CommandArg[] };

export type ChangedWhen =
  | 'always'
  | 'never'
  | { readonly outputContains: string }
  | { readonly outputNotContains: string };

/**
 * One step of a command pipeline, declarative so the signature can hash it.
 * `skipIf` is the idempotency guard (Ansible `creates:`/`when:`), `capture`
 * registers stdout into the scope for later steps, and `changedWhen` classifies
 * a successful run.
 */
export interface CommandStep {
  readonly label: string;
  readonly argv: readonly CommandArg[];
  readonly env?: Readonly<Record<string, CommandEnvValue>>;
  readonly skipIf?: StepGuard;
  readonly capture?: string;
  readonly changedWhen?: ChangedWhen;
}

export type ActivationStatus = 'changed' | 'unchanged' | 'failed' | 'blocked';

/** Per-entry report for the multi-action kinds (`defaults` writes, command steps). */
export interface StepReport {
  readonly key: string;
  /**
   * Display-only free text with per-kind semantics: the resolved argv for a
   * command step, the applied actions for a pipx item, `installed <tag>` for a
   * release, etc. It is rendered, never parsed — no consumer depends on its shape.
   */
  readonly value: string;
  readonly status: 'changed' | 'unchanged' | 'failed';
  readonly error?: string;
}

export interface ActivationReport {
  readonly verb: Verb;
  readonly source: string;
  readonly dest: string;
  readonly status: ActivationStatus;
  readonly error?: string;
  readonly entries?: readonly StepReport[];
}

export interface Described {
  readonly verb: Verb;
  readonly source: string;
  readonly dest: string;
}
