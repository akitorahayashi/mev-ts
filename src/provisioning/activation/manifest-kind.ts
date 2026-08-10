import { basename, extname } from 'node:path';
import type { Context } from '../../host/context';
import type {
  ActivationReport,
  ActivationRunOptions,
  AssetCheck,
  AssetReference,
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
  references(activation: A): readonly AssetReference[];
  assetChecks(activation: A): readonly AssetCheck[];
  run(
    activation: A,
    context: Context,
    options?: ActivationRunOptions,
  ): Promise<ActivationReport>;
}

/**
 * Build the complete kind handler shared by every manifest-backed activation.
 * Each kind supplies only its parse, label, description, and step builder; the
 * reconcile envelope, the single-asset reference, the deployed-manifest read,
 * and the build-time asset check live here once instead of being copied per
 * kind. The check reuses `spec.parse`, so validation and runtime parsing cannot
 * drift apart.
 */
export function manifestKind<A extends ManifestActivation, D>(
  spec: ManifestKindSpec<A, D>,
): ManifestKind<A> {
  return {
    describe: spec.describe,
    references: (activation) => [{ key: activation.configKey }],
    assetChecks: (activation) => [
      {
        key: activation.configKey,
        parse: async (raw, key) => {
          await spec.parse(raw, key);
        },
      },
    ],
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
