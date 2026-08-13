import { mevPath, resolveHostPath } from '../host/path';

export const AGENTS_SECTIONS_PREFIX = 'coder/agents-sections';
export const SKILLS_PREFIX = 'coder/skills';

/**
 * The coder intermediate-entity root `~/.mev/coder/`, a sibling of the deploy
 * store `~/.mev/roles/`. It holds generated entities — the concatenated
 * AGENTS.md, the skills directory, and the selection manifests — kept apart
 * from the deployed sources so re-deploying coder never overwrites them. Agent
 * tools symlink to entities under this root.
 */
function coderPath(home: string, name: string): string {
  return resolveHostPath(mevPath('coder', name), home);
}

/** The generated AGENTS.md, built by concatenating the enabled sections. */
export function agentsFile(home: string): string {
  return coderPath(home, 'AGENTS.md');
}

/** The generated skills directory, holding one symlink per enabled skill. */
export function skillsDir(home: string): string {
  return coderPath(home, 'skills');
}

/**
 * The AGENTS.md selection manifest; its `disabled` list excludes sections.
 * Absence enables every catalog section.
 */
export function agentsManifest(home: string): string {
  return coderPath(home, 'agents-sections.yml');
}

/**
 * The skills selection manifest; its `disabled` list excludes skills. Absence
 * enables every catalog skill.
 */
export function skillsManifest(home: string): string {
  return coderPath(home, 'skills-selection.yml');
}
