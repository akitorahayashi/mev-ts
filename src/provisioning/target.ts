import type { Context } from '../host/context';
import type { Activation } from './activation';
import {
  type PackageInput,
  type PackageRequirement,
  packages,
} from './package';

/**
 * A named unit of provisioning. A target owns the tags and aliases that select
 * it, the role whose assets it deploys, protection required before replacing
 * that role, its packages, and its activations. `optional` targets are still
 * selectable by tag but excluded from a full-environment `create`.
 */
export interface Target {
  readonly name: string;
  readonly description: string;
  readonly tags: readonly [string, ...string[]];
  readonly aliases: readonly string[];
  readonly role: string;
  readonly packages: PackageRequirement;
  readonly preserveBeforeDeploy?: (context: Context) => Promise<void>;
  readonly activations: readonly Activation[];
  readonly optional: boolean;
}

interface TargetDefinition {
  readonly description: string;
  readonly tags?: readonly [string, ...string[]];
  readonly aliases?: readonly string[];
  readonly role: string;
  readonly packages?: PackageInput;
  readonly preserveBeforeDeploy?: (context: Context) => Promise<void>;
  readonly activations: readonly Activation[];
  readonly optional?: boolean;
}

export function target(name: string, definition: TargetDefinition): Target {
  return {
    name,
    description: definition.description,
    tags: definition.tags ?? [name],
    aliases: definition.aliases ?? [],
    role: definition.role,
    packages: packages(definition.packages),
    preserveBeforeDeploy: definition.preserveBeforeDeploy,
    activations: definition.activations,
    optional: definition.optional ?? false,
  };
}
