import {
  type PackageInput,
  type PackageRequirement,
  packages,
} from '../brew/package';
import type { Context } from '../host/context';
import type { Activation } from './activation';

/**
 * A per-machine fact that is not part of declared intent and so cannot reach the
 * target signature, which must stay machine-independent. A target that bakes one
 * into its applied output is stale the moment the fact changes, so `mev config`
 * invalidates every target declaring it.
 */
export type PerMachineInput = 'githubSshHost';

/**
 * A named unit of provisioning. A target owns its canonical selector and
 * aliases, the role whose assets it deploys, protection required before
 * replacing that role, its packages, and its activations. `optional` targets
 * are still selectable but excluded from a full-environment `create`.
 */
export interface Target {
  readonly name: string;
  readonly description: string;
  readonly aliases: readonly string[];
  readonly role: string;
  readonly packages: PackageRequirement;
  readonly preserveBeforeDeploy?: (context: Context) => Promise<void>;
  readonly activations: readonly Activation[];
  readonly optional: boolean;
  /**
   * Per-machine facts baked into this target's applied output. Declared only
   * where the value is materialized: a target that reads the same fact live on
   * every run is never stale for it, so listing it would re-provision for
   * nothing.
   */
  readonly perMachineInputs: readonly PerMachineInput[];
}

interface TargetDefinition {
  readonly description: string;
  readonly aliases?: readonly string[];
  readonly role: string;
  readonly packages?: PackageInput;
  readonly preserveBeforeDeploy?: (context: Context) => Promise<void>;
  readonly activations: readonly Activation[];
  readonly optional?: boolean;
  readonly perMachineInputs?: readonly PerMachineInput[];
}

export function target(name: string, definition: TargetDefinition): Target {
  return {
    name,
    description: definition.description,
    aliases: definition.aliases ?? [],
    role: definition.role,
    packages: packages(definition.packages),
    preserveBeforeDeploy: definition.preserveBeforeDeploy,
    activations: definition.activations,
    optional: definition.optional ?? false,
    perMachineInputs: definition.perMachineInputs ?? [],
  };
}
