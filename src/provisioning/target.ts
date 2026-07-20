import {
  type PackageInput,
  type PackageRequirement,
  packages,
} from '../brew/package';
import type { Context } from '../host/context';
import type { Activation } from './activation';

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
}

interface TargetDefinition {
  readonly description: string;
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
    aliases: definition.aliases ?? [],
    role: definition.role,
    packages: packages(definition.packages),
    preserveBeforeDeploy: definition.preserveBeforeDeploy,
    activations: definition.activations,
    optional: definition.optional ?? false,
  };
}
