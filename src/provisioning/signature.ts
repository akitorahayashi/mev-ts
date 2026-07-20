import { createHash } from 'node:crypto';
import type { AssetSource } from '../assets/registry';
import type { PackageRequirement } from '../brew/package';
import { commandReadKey } from './activation/command';
import type { Activation, ChangedWhen } from './activation/contract';
import type { Target } from './target';

type ActivationIntent =
  | {
      readonly kind: 'file';
      readonly source: string;
      readonly dest: string;
    }
  | {
      readonly kind: 'tree';
      readonly prefix: string;
      readonly dest: string;
    }
  | {
      readonly kind: 'defaults' | 'duti' | 'pipx' | 'release';
      readonly configKey: string;
    }
  | {
      readonly kind: 'editorExtensions';
      readonly command: string;
      readonly configKey: string;
    }
  | {
      readonly kind: 'coderAgents';
      readonly sectionsPrefix: string;
      readonly dests: readonly string[];
    }
  | {
      readonly kind: 'coderSkills';
      readonly skillsPrefix: string;
      readonly targetDirs: readonly string[];
    }
  | {
      readonly kind: 'zedSettings';
      readonly base: string;
      readonly overridesPrefix: string;
      readonly dest: string;
    }
  | {
      readonly kind: 'command';
      readonly label: string;
      readonly intentVersion: number;
      readonly reads: readonly (readonly [string, string])[];
      readonly steps: readonly CommandStepIntent[];
    }
  | {
      readonly kind: 'remoteInstaller';
      readonly label: string;
      readonly url: string;
      readonly integrity:
        | { readonly checksumUrl: string }
        | { readonly acknowledgedUnverified: true };
      readonly interpreter: string;
      readonly args: readonly string[];
      readonly creates: string;
      readonly env: readonly (readonly [string, string])[];
      readonly pathPrefix: readonly string[];
    };

type ChangedWhenIntent =
  | 'always'
  | 'never'
  | { readonly outputContains: string }
  | { readonly outputNotContains: string };

interface CommandStepIntent {
  readonly label: string;
  readonly capture: string | null;
  readonly changedWhen: ChangedWhenIntent;
}

interface AssetIntent {
  readonly key: string;
  readonly content: string;
  readonly executable: boolean;
}

interface SignatureInput {
  readonly target: string;
  readonly role: string;
  readonly packages: PackageRequirement;
  readonly assets: readonly AssetIntent[];
  readonly activations: readonly ActivationIntent[];
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function packageIntent(packages: PackageRequirement): PackageRequirement {
  return {
    taps: sortedUnique(packages.taps),
    formulae: sortedUnique(packages.formulae),
    casks: sortedUnique(packages.casks),
  };
}

function changedWhenIntent(rule: ChangedWhen | undefined): ChangedWhenIntent {
  return rule ?? 'always';
}

function activationIntent(activation: Activation): ActivationIntent {
  switch (activation.kind) {
    case 'file':
      return {
        kind: activation.kind,
        source: activation.source.key,
        dest: activation.dest.rel,
      };
    case 'tree':
      return {
        kind: activation.kind,
        prefix: activation.prefix,
        dest: activation.dest.rel,
      };
    case 'defaults':
    case 'duti':
    case 'pipx':
    case 'release':
      return {
        kind: activation.kind,
        configKey: activation.configKey,
      };
    case 'editorExtensions':
      return {
        kind: activation.kind,
        command: activation.command,
        configKey: activation.configKey,
      };
    case 'coderAgents':
      return {
        kind: activation.kind,
        sectionsPrefix: activation.sectionsPrefix,
        dests: activation.dests.map((dest) => dest.rel),
      };
    case 'coderSkills':
      return {
        kind: activation.kind,
        skillsPrefix: activation.skillsPrefix,
        targetDirs: activation.targetDirs.map((dest) => dest.rel),
      };
    case 'zedSettings':
      return {
        kind: activation.kind,
        base: activation.base.key,
        overridesPrefix: activation.overridesPrefix,
        dest: activation.dest.rel,
      };
    case 'command':
      return {
        kind: activation.kind,
        label: activation.label,
        intentVersion: activation.intentVersion,
        reads: Object.entries(activation.reads ?? {})
          .map(([name, read]) => [name, commandReadKey(read)] as const)
          .sort(([left], [right]) => left.localeCompare(right)),
        steps: activation.steps.map((step) => ({
          label: step.label,
          capture: step.capture ?? null,
          changedWhen: changedWhenIntent(step.changedWhen),
        })),
      };
    case 'remoteInstaller':
      return {
        kind: activation.kind,
        label: activation.label,
        url: activation.url,
        integrity:
          'checksumUrl' in activation.integrity
            ? { checksumUrl: activation.integrity.checksumUrl }
            : { acknowledgedUnverified: true },
        interpreter: activation.interpreter,
        args: activation.args,
        creates: activation.creates.rel,
        env: Object.entries(activation.env ?? {}).sort(([left], [right]) =>
          left.localeCompare(right),
        ),
        pathPrefix: (activation.pathPrefix ?? []).map((path) => path.rel),
      };
  }
}

async function assetIntents(
  role: string,
  assets: AssetSource,
): Promise<AssetIntent[]> {
  const keys = [...assets.keysByPrefix(`${role}/`)].sort();
  return Promise.all(
    keys.map(async (key) => ({
      key,
      content: await assets.read(key),
      executable: assets.isExecutable(key),
    })),
  );
}

/** Hash the user-visible desired state of one target, excluding runner code. */
export async function targetSignature(
  target: Target,
  assets: AssetSource,
): Promise<string> {
  const input: SignatureInput = {
    target: target.name,
    role: target.role,
    packages: packageIntent(target.packages),
    assets: await assetIntents(target.role, assets),
    activations: target.activations.map(activationIntent),
  };
  const digest = createHash('sha256')
    .update(JSON.stringify(input))
    .digest('hex');
  return `sha256:${digest}`;
}
