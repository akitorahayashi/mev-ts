import { join } from 'node:path';
import { deployedDir } from '../../assets/ref';

/**
 * The coder intermediate-entity root `~/.config/mev/coder/`, a sibling of the
 * deploy store `~/.config/mev/roles/`. It holds generated entities — the
 * concatenated AGENTS.md, the skills directory, and the selection manifests —
 * kept apart from the deployed sources so re-deploying coder never overwrites
 * them. Agent tools symlink to entities under this root.
 */
function coderRoot(home: string): string {
  return join(home, '.config', 'mev', 'coder');
}

/** The generated AGENTS.md, built by concatenating the enabled sections. */
export function agentsFile(home: string): string {
  return join(coderRoot(home), 'AGENTS.md');
}

/** The generated skills directory, holding one symlink per enabled skill. */
export function skillsDir(home: string): string {
  return join(coderRoot(home), 'skills');
}

/**
 * The AGENTS.md selection manifest; its `disabled` list excludes sections.
 * Absence enables every catalog section.
 */
export function agentsManifest(home: string): string {
  return join(coderRoot(home), 'agents-sections.yml');
}

/**
 * The skills selection manifest; its `disabled` list excludes skills. Absence
 * enables every catalog skill.
 */
export function skillsManifest(home: string): string {
  return join(coderRoot(home), 'skills-selection.yml');
}

/** The deployed source directory for an asset prefix under the deploy store. */
export function deployedSource(prefix: string, home: string): string {
  return deployedDir(prefix, home);
}
