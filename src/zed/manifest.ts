import { selectionPolicy } from '../config-selection/selection';

/**
 * The override selection manifest records only what the user turned on. The
 * catalog is the authority for what exists; anything absent from the stored list
 * is off (opt-in), so a newly added override never silently starts applying
 * itself.
 */
export const overrideSelection = selectionPolicy('opt-in', 'override manifest');
