import { CommandLineError } from '../errors';
import type { Feature } from './feature';
import { ghFeature } from './features/gh';
import { gitFeature } from './features/git';
import { shellFeature } from './features/shell';

/** Every feature mev can provision. Tags, aliases, and packages derive from here. */
const features: readonly Feature[] = [gitFeature, shellFeature, ghFeature];

/** Resolve a tag or alias to its owning feature. */
export function resolveFeature(selector: string): Feature {
  const match = features.find(
    (feature) =>
      feature.tags.includes(selector) || feature.aliases.includes(selector),
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
  return features.flatMap((feature) => [...feature.tags, ...feature.aliases]);
}

/** Every registered feature, in declaration order. */
export function allFeatures(): readonly Feature[] {
  return features;
}
