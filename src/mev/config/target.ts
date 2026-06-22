import type { Resource } from '../resources/model';

export interface Target {
  readonly name: string;
  readonly description: string;
  readonly tags: readonly string[];
  readonly aliases: readonly string[];
  readonly resources: readonly Resource[];
}

interface TargetDefinition {
  readonly description: string;
  readonly tags?: readonly string[];
  readonly aliases?: readonly string[];
  readonly resources: readonly Resource[];
}

export function target(name: string, definition: TargetDefinition): Target {
  return {
    name,
    description: definition.description,
    tags: definition.tags ?? [name],
    aliases: definition.aliases ?? [],
    resources: definition.resources,
  };
}
