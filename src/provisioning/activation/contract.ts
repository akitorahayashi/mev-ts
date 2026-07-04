import type { AssetRef } from '../../assets/ref';
import type { HostPath } from '../../host/path';

export type Verb = 'link' | 'apply' | 'run';

/**
 * A single config materialization or host mutation. `file`/`tree` link deployed
 * assets into place; `defaults` applies a macOS `defaults write` list;
 * `editorExtensions` reconciles an editor's installed extensions against a
 * manifest; `command` runs an ordered, idempotent host-command pipeline that
 * shares a derived scope.
 * The union is the source of truth for the activation vocabulary — every kind is
 * dispatched exhaustively by `runActivation` and `describeActivation`.
 */
export type Activation =
  | {
      readonly kind: 'file';
      readonly verb: Verb;
      readonly source: AssetRef;
      readonly dest: HostPath;
    }
  | {
      readonly kind: 'tree';
      readonly verb: Verb;
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
      readonly reads?: Readonly<Record<string, string>>;
      readonly steps: readonly CommandStep[];
    }
  | {
      readonly kind: 'release';
      readonly configKey: string;
    };

/**
 * Resolved inputs available to a command step's thunks. `home` and `basePath`
 * (the inherited `PATH`) are host facts; `ref` looks up an asset value declared
 * in `reads` or the stdout of a prior `capture` step by name, throwing when the
 * name is absent so a missing capture fails loudly rather than rendering as an
 * `undefined` argument.
 */
export interface CommandScope {
  readonly home: string;
  readonly basePath: string;
  ref(name: string): string;
}

export type StepGuard =
  | { readonly pathExists: string }
  | { readonly commandSucceeds: readonly string[] };

export type ChangedWhen =
  | 'always'
  | 'never'
  | { readonly stdoutContains: string }
  | { readonly outputContains: string }
  | { readonly outputNotContains: string };

/**
 * One step of a command pipeline. Thunks resolve against the live scope so the
 * definition stays declarative TS rather than a string template. `skipIf` is the
 * idempotency guard (Ansible `creates:`/`when:`), `capture` registers stdout into
 * the scope for later steps, and `changedWhen` classifies a successful run.
 */
export interface CommandStep {
  readonly argv: (scope: CommandScope) => readonly string[];
  readonly env?: (scope: CommandScope) => Readonly<Record<string, string>>;
  readonly skipIf?: (scope: CommandScope) => StepGuard;
  readonly capture?: string;
  readonly changedWhen?: ChangedWhen;
  readonly label?: string;
}

export type ActivationStatus = 'changed' | 'unchanged' | 'failed' | 'blocked';

/** Per-entry report for the multi-action kinds (`defaults` writes, command steps). */
export interface StepReport {
  readonly key: string;
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

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
