import { CommandLineError } from '../errors';
import type { Feature } from './feature';
import { gitFeature } from './features/git';

/** Every feature mev can provision. Tags, aliases, and packages derive from here. */
const features: readonly Feature[] = [gitFeature];

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
