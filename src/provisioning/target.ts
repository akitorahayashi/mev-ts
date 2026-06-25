import type { Activation } from './activation';
import {
  type PackageInput,
  type PackageRequirement,
  packages,
} from './package';

/**
 * A named unit of provisioning. A target owns the tags and aliases that select
 * it, the role whose assets it deploys, the packages it requires, and the
 * activations that link those assets into place.
 */
export interface Target {
  readonly name: string;
  readonly description: string;
  readonly tags: readonly string[];
  readonly aliases: readonly string[];
  readonly role: string;
  readonly packages: PackageRequirement;
  readonly activations: readonly Activation[];
}

interface TargetDefinition {
  readonly description: string;
  readonly tags?: readonly string[];
  readonly aliases?: readonly string[];
  readonly role: string;
  readonly packages?: PackageInput;
  readonly activations: readonly Activation[];
}

export function target(name: string, definition: TargetDefinition): Target {
  return {
    name,
    description: definition.description,
    tags: definition.tags ?? [name],
    aliases: definition.aliases ?? [],
    role: definition.role,
    packages: packages(definition.packages),
    activations: definition.activations,
  };
}
