import type { AssetRef } from '../assets/ref';
import type { HostPath } from '../host/path';
import {
  type PackageInput,
  type PackageRequirement,
  packages,
} from './package';

export type Verb = 'copy' | 'link';

/**
 * A single config materialization from the deploy store to a host path. A
 * `file` activation links one deployed asset; a `tree` activation mirrors every
 * asset under a prefix into a destination directory, preserving unmanaged files
 * already present there.
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
    };

export function link(source: AssetRef, dest: HostPath): Activation {
  return { kind: 'file', verb: 'link', source, dest };
}

export function linkTree(prefix: string, dest: HostPath): Activation {
  return { kind: 'tree', verb: 'link', prefix, dest };
}

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
