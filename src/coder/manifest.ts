import { selectionPolicy } from '../config-selection/selection';

/**
 * The AGENTS.md/skills selection manifest records only what the user turned off.
 * The catalog is the authority for what exists; anything absent from the stored
 * list is enabled (opt-out), so catalog entries added across mev updates stay
 * enabled rather than being silently dropped.
 */
export const catalogSelection = selectionPolicy(
  'opt-out',
  'selection manifest',
);
