import type { AssetRef } from '../../assets/ref';
import type { AssetSource } from '../../assets/registry';
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
 * `reconcile.ts` envelope. See the per-kind table in docs/architecture/activation.md.
 */
export type Activation =
  | {
      readonly kind: 'file';
      readonly source: AssetRef;
      readonly dest: HostPath;
    }
  | {
      readonly kind: 'groveConfig';
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
      readonly kind: 'pnpm';
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
      readonly kind: 'agentPlugins';
      readonly configKey: string;
      readonly pathPrefix: readonly [HostPath, ...HostPath[]];
    }
  | {
      readonly kind: 'zedSettings';
      readonly base: AssetRef;
      readonly overridesPrefix: string;
      readonly dest: HostPath;
    }
  | {
      readonly kind: 'declaredKeys';
      readonly source: AssetRef;
      readonly dest: HostPath;
      readonly format: 'toml' | 'json' | 'jsonc';
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
      /**
       * Asset reads bound into the scope `args` resolve against, the same
       * vocabulary the `command` kind uses. A versioned installer therefore
       * stays a declaration whose version is a role asset, rather than a shell
       * string with the version concatenated into it.
       */
      readonly reads?: Readonly<Record<string, CommandRead>>;
      readonly args: readonly CommandArg[];
      /**
       * The path whose presence means the installer has already run. Sufficient
       * for an unversioned installer; a versioned one declares `skipIf` instead,
       * because the path exists at every version.
       */
      readonly creates: HostPath;
      /** Overrides `creates` when presence alone does not mean up to date. */
      readonly skipIf?: StepGuard;
      /**
       * Self-update command for an already installed latest-assumed tool. It
       * runs only under explicit upgrade intent; a fresh install never invokes
       * it again in the same activation.
       */
      readonly upgrade?: RemoteInstallerUpgrade;
      readonly env?: Readonly<Record<string, CommandEnvValue>>;
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
 * The asset key of a named read for a command activation; its trimmed content
 * becomes the bound value. Deliberately data, not a function: `signature.ts`
 * drops function values from the hash, so a callable read form would let an
 * edit to its body change the bound value without flipping the target
 * signature, and `sync` would skip a target that is genuinely stale. Express
 * any future validation as data (`{ key, pattern }`) so it hashes.
 */
export type CommandRead = string;

export type StepGuard =
  | { readonly pathExists: CommandArg }
  | { readonly commandSucceeds: readonly CommandArg[] }
  /**
   * Satisfied when `argv` exits zero and its trimmed stdout equals `exact`, or
   * contains `contains`. Declarative data so it hashes into the target
   * signature, which a `sh -c '... | grep ...'` pipeline could not do — the
   * comparison would be buried in a shell string the signature sees only as an
   * opaque argument. `contains` is for tools that decorate the value with
   * unrelated detail, as `rustup default` appends the host triple.
   */
  | {
      readonly commandOutputMatches: {
        readonly argv: readonly CommandArg[];
        readonly exact?: CommandArg;
        readonly contains?: CommandArg;
      };
    };

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

export type RemoteInstallerUpgrade = CommandStep & {
  /** Maps a known updater safety precondition to a blocked activation. */
  readonly blockedWhen?: { readonly errorContains: string };
};

/**
 * Per-run execution intent threaded from the CLI into the runners that consume
 * it. `upgrade` re-resolves latest for installed latest-assumed items (the
 * explicit `--upgrade` flag); it never alters declared intent, so target
 * signatures and sync staleness are unaffected.
 */
export interface ActivationRunOptions {
  readonly upgrade: boolean;
}

export type ActivationStatus = 'changed' | 'unchanged' | 'failed' | 'blocked';

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

/** An embedded asset an activation references: one key, or every key under a prefix. */
export type AssetReference =
  | { readonly key: string }
  | { readonly prefix: string };

/**
 * One embedded asset to check before the binary is built. `parse` is the same
 * function the runner uses at apply time, so a parser swap cannot leave build
 * validation and runtime disagreeing about what a valid manifest is; a check
 * without one asserts only that the asset exists.
 */
export interface AssetCheck {
  readonly key: string;
  readonly parse?: (
    raw: string,
    key: string,
    assets: AssetSource,
  ) => void | Promise<void>;
}
