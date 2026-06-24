import { CommandLineError } from '../errors';
import type { Target } from './target';
import { ghTarget } from './targets/gh';
import { gitTarget } from './targets/git';
import { shellTarget } from './targets/shell';

/** Every target mev can provision. Tags, aliases, and packages derive from here. */
const targets: readonly Target[] = [gitTarget, shellTarget, ghTarget];

/** Resolve a tag or alias to its owning target. */
export function resolveTarget(selector: string): Target {
  const match = targets.find(
    (t) => t.tags.includes(selector) || t.aliases.includes(selector),
  );
  if (!match) {
    throw new CommandLineError(
      `Unknown tag '${selector}'. Available: ${availableSelectors().join(', ')}.`,
    );
  }
  return match;
}

/** All selectable tags and aliases, in declaration order. */
export function availableSelectors(): string[] {
  return targets.flatMap((t) => [...t.tags, ...t.aliases]);
}

/** Every registered target, in declaration order. */
export function allTargets(): readonly Target[] {
  return targets;
}
