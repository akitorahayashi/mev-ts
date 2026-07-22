import { basename, extname } from 'node:path';
import type { Context } from '../../host/context';
import type { ActivationReport, Described } from './contract';
import { readDeployedManifest } from './manifest';
import { type ReconcileStep, reconcile } from './reconcile';

/** An activation kind whose intent is a single deployed manifest asset. */
interface ManifestActivation {
  readonly configKey: string;
}

interface ManifestKindSpec<A extends ManifestActivation, D> {
  /** Parse the deployed manifest into the declared items. */
  readonly parse: (raw: string, path: string) => D[] | Promise<D[]>;
  /** Deploy-first label surfaced when the manifest is missing. */
  readonly manifestLabel: string;
  /** Stable description of the activation's verb and endpoints. */
  readonly describe: (activation: A) => Described;
  /** Build the reconcile steps from the declared items. */
  readonly steps: (
    declared: readonly D[],
    activation: A,
    context: Context,
  ) => Promise<readonly ReconcileStep[]>;
  /** Bounded parallelism for IO-bound, independent items; serial when unset. */
  readonly concurrency?: number;
}

/** The describe/configAssets/run trio every manifest-backed kind exposes. */
export interface ManifestKind<A extends ManifestActivation> {
  describe(activation: A): Described;
  configAssets(activation: A): readonly string[];
  run(activation: A, context: Context): Promise<ActivationReport>;
}

/**
 * Build the describe/configAssets/run trio shared by every manifest-backed
 * activation kind (defaults, duti, pipx, editorExtensions, release). Each kind
 * supplies only its parse, label, description, and step builder; the reconcile
 * envelope, the single-asset `configAssets` ceremony, and the deployed-manifest
 * read live here once instead of being copied per kind.
 */
export function manifestKind<A extends ManifestActivation, D>(
  spec: ManifestKindSpec<A, D>,
): ManifestKind<A> {
  return {
    describe: spec.describe,
    configAssets: (activation) => [activation.configKey],
    run: (activation, context) =>
      reconcile<D>(spec.describe(activation), {
        declare: () =>
          readDeployedManifest(
            activation.configKey,
            context.home,
            spec.parse,
            spec.manifestLabel,
          ),
        steps: (declared) => spec.steps(declared, activation, context),
        concurrent: spec.concurrency,
      }),
  };
}

/** The common describe source: the manifest file's basename without extension. */
export function manifestSource(configKey: string): string {
  return basename(configKey, extname(configKey));
}
