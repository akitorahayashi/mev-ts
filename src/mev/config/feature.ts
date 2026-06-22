import type { Resource } from '../resources/model';

/**
 * A named unit of provisioning. A feature owns the tags and aliases that select
 * it and the resources it contributes, so tag, alias, and package information
 * are all derived from the same definition rather than parallel tables.
 */
export interface Feature {
  readonly name: string;
  readonly description: string;
  readonly tags: readonly string[];
  readonly aliases: readonly string[];
  readonly resources: readonly Resource[];
}

interface FeatureDefinition {
  readonly description: string;
  readonly tags?: readonly string[];
  readonly aliases?: readonly string[];
  readonly resources: readonly Resource[];
}

export function feature(name: string, definition: FeatureDefinition): Feature {
  return {
    name,
    description: definition.description,
    tags: definition.tags ?? [name],
    aliases: definition.aliases ?? [],
    resources: definition.resources,
  };
}
