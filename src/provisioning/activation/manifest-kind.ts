import { basename, extname } from 'node:path';
import type { Context } from '../../host/context';
import type {
  ActivationReport,
  ActivationRunOptions,
  Described,
} from './contract';
import { readDeployedManifest } from './manifest';
import { type ReconcileStep, reconcile } from './reconcile';

interface ManifestActivation {
  readonly configKey: string;
}

interface ManifestKindSpec<A extends ManifestActivation, D> {
  readonly parse: (raw: string, path: string) => D[] | Promise<D[]>;
  /** Deploy-first label surfaced when the manifest is missing. */
  readonly manifestLabel: string;
  readonly describe: (activation: A) => Described;
  readonly steps: (
    declared: readonly D[],
    activation: A,
    context: Context,
    options: ActivationRunOptions,
  ) => Promise<readonly ReconcileStep[]>;
  /** Bounded parallelism for IO-bound, independent items; serial when unset. */
  readonly concurrency?: number;
}

export interface ManifestKind<A extends ManifestActivation> {
  describe(activation: A): Described;
  configAssets(activation: A): readonly string[];
  run(
    activation: A,
    context: Context,
    options?: ActivationRunOptions,
  ): Promise<ActivationReport>;
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
    run: (activation, context, options = { upgrade: false }) =>
      reconcile<D>(spec.describe(activation), {
        declare: () =>
          readDeployedManifest(
            activation.configKey,
            context.home,
            spec.parse,
            spec.manifestLabel,
          ),
        steps: (declared) => spec.steps(declared, activation, context, options),
        concurrent: spec.concurrency,
      }),
  };
}

export function manifestSource(configKey: string): string {
  return basename(configKey, extname(configKey));
}
