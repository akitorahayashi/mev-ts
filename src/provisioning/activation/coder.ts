import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { deployedDirSymbolic } from '../../assets/ref';
import { readDirentsIfPresent, readlinkIfPresent } from '../../host/absence';
import type { Context } from '../../host/context';
import { type HostPath, resolveHostPath } from '../../host/path';
import { isSymlinkTo, placeSymlink } from '../../host/symlink';
import { buildAgents } from '../coder/agents';
import { readSections, readSkills } from '../coder/catalog';
import { readDisabled, resolve } from '../coder/manifest';
import {
  agentsFile,
  agentsManifest,
  deployedSource,
  skillsDir,
  skillsManifest,
} from '../coder/paths';
import { buildSkills } from '../coder/skills';
import {
  type Activation,
  type ActivationReport,
  type Described,
  errorMessage,
} from './contract';

type CoderAgentsActivation = Extract<Activation, { kind: 'coderAgents' }>;
type CoderSkillsActivation = Extract<Activation, { kind: 'coderSkills' }>;

/**
 * Build the intermediate AGENTS.md from the enabled sections and symlink it to
 * each agent tool's instruction path.
 */
export function coderAgents(
  sectionsPrefix: string,
  dests: readonly HostPath[],
): Activation {
  return { kind: 'coderAgents', sectionsPrefix, dests };
}

/**
 * Build the intermediate skills directory from the enabled skills and symlink
 * each enabled skill into every agent tool's skills directory.
 */
export function coderSkills(
  skillsPrefix: string,
  targetDirs: readonly HostPath[],
): Activation {
  return { kind: 'coderSkills', skillsPrefix, targetDirs };
}

export function describeCoderAgents(
  activation: CoderAgentsActivation,
): Described {
  return {
    verb: 'apply',
    source: deployedDirSymbolic(activation.sectionsPrefix),
    dest: 'agent instructions',
  };
}

export function describeCoderSkills(
  activation: CoderSkillsActivation,
): Described {
  return {
    verb: 'apply',
    source: deployedDirSymbolic(activation.skillsPrefix),
    dest: 'agent skills',
  };
}

/** Symlink `target` into each dest, returning whether any link changed. */
async function fanoutFile(
  dests: readonly HostPath[],
  target: string,
  context: Context,
): Promise<boolean> {
  let changed = false;
  for (const dest of dests) {
    const link = resolveHostPath(dest, context.home);
    if (await isSymlinkTo(link, target)) {
      continue;
    }
    await placeSymlink(link, target, context.overwrite);
    changed = true;
  }
  return changed;
}

/**
 * Make each target directory hold one symlink per enabled skill, pointing at
 * the intermediate skills entry. Managed links (those into `intermediate`) for
 * skills no longer enabled are removed. Returns whether anything changed.
 */
async function fanoutSkills(
  targetDirs: readonly HostPath[],
  intermediate: string,
  enabled: readonly string[],
  context: Context,
): Promise<boolean> {
  const managedPrefix = `${intermediate}/`;
  let changed = false;
  for (const dir of targetDirs) {
    const root = resolveHostPath(dir, context.home);
    const entries = (await readDirentsIfPresent(root)) ?? [];
    for (const entry of entries) {
      if (!entry.isSymbolicLink() || enabled.includes(entry.name)) {
        continue;
      }
      const path = join(root, entry.name);
      const linkTarget = await readlinkIfPresent(path);
      if (linkTarget?.startsWith(managedPrefix)) {
        await rm(path, { force: true });
        changed = true;
      }
    }
    for (const name of enabled) {
      const link = join(root, name);
      const target = join(intermediate, name);
      if (await isSymlinkTo(link, target)) {
        continue;
      }
      await placeSymlink(link, target, context.overwrite);
      changed = true;
    }
  }
  return changed;
}

export async function runCoderAgents(
  activation: CoderAgentsActivation,
  context: Context,
): Promise<ActivationReport> {
  const base = describeCoderAgents(activation);
  try {
    const sourceDir = deployedSource(activation.sectionsPrefix, context.home);
    const catalog = await readSections(sourceDir);
    const disabled = await readDisabled(agentsManifest(context.home));
    const { enabled } = resolve(catalog, disabled);
    const output = agentsFile(context.home);
    const built = await buildAgents(sourceDir, enabled, output);
    const linked = await fanoutFile(activation.dests, output, context);
    return { ...base, status: built || linked ? 'changed' : 'unchanged' };
  } catch (error) {
    return { ...base, status: 'failed', error: errorMessage(error) };
  }
}

export async function runCoderSkills(
  activation: CoderSkillsActivation,
  context: Context,
): Promise<ActivationReport> {
  const base = describeCoderSkills(activation);
  try {
    const sourceDir = deployedSource(activation.skillsPrefix, context.home);
    const catalog = await readSkills(sourceDir);
    const disabled = await readDisabled(skillsManifest(context.home));
    const { enabled } = resolve(catalog, disabled);
    const intermediate = skillsDir(context.home);
    const built = await buildSkills(sourceDir, enabled, intermediate);
    const linked = await fanoutSkills(
      activation.targetDirs,
      intermediate,
      enabled,
      context,
    );
    return { ...base, status: built || linked ? 'changed' : 'unchanged' };
  } catch (error) {
    return { ...base, status: 'failed', error: errorMessage(error) };
  }
}
