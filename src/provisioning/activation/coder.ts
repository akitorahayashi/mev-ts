import { join } from 'node:path';
import { deployedDir, deployedDirSymbolic } from '../../assets/ref';
import { buildAgents } from '../../coder/agents';
import { readSections, readSkills } from '../../coder/catalog';
import { readDisabled } from '../../coder/manifest';
import {
  agentsFile,
  agentsManifest,
  skillsDir,
  skillsManifest,
} from '../../coder/paths';
import { buildSkills } from '../../coder/skills';
import { resolveSelection } from '../../config-selection/selection';
import { errorMessage } from '../../errors';
import type { Context } from '../../host/context';
import { reconcileManagedLinks } from '../../host/managed-links';
import { type HostPath, resolveHostPath, symbolic } from '../../host/path';
import { isSymlinkTo, placeSymlink } from '../../host/symlink';
import type {
  Activation,
  ActivationReport,
  Described,
  StepReport,
} from './contract';
import { guarded } from './reconcile';

type CoderAgentsActivation = Extract<Activation, { kind: 'coderAgents' }>;
type CoderSkillsActivation = Extract<Activation, { kind: 'coderSkills' }>;

/**
 * Report opt-out manifest names the catalog no longer contains. A stale disabled
 * entry is benign (it applies nothing), so it surfaces as `unchanged` config
 * drift rather than failing the run.
 */
function staleManifestEntries(unknown: readonly string[]): StepReport[] {
  return unknown.map((name) => ({
    key: name,
    value: 'stale manifest entry',
    status: 'unchanged',
  }));
}

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

/** The embedded section catalog a `coderAgents` activation validates. */
export function coderAgentsConfigAssets(
  activation: CoderAgentsActivation,
): readonly string[] {
  return [join(activation.sectionsPrefix, 'catalog.yml')];
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

/** The outcome of a fan-out: whether anything changed, plus isolated failures. */
interface LinkFanout {
  readonly changed: boolean;
  readonly failed: readonly StepReport[];
}

/** Symlink `target` into each dest, isolating a per-dest failure to its entry. */
async function fanoutFile(
  dests: readonly HostPath[],
  target: string,
  context: Context,
): Promise<LinkFanout> {
  let changed = false;
  const failed: StepReport[] = [];
  for (const dest of dests) {
    const link = resolveHostPath(dest, context.home);
    try {
      if (await isSymlinkTo(link, target)) continue;
      await placeSymlink(link, target);
      changed = true;
    } catch (error) {
      failed.push({
        key: symbolic(dest),
        value: 'link failed',
        status: 'failed',
        error: errorMessage(error),
      });
    }
  }
  return { changed, failed };
}

/**
 * Make each target directory hold one symlink per enabled skill, pointing at the
 * intermediate skills entry; managed links for skills no longer enabled are
 * removed. Each target directory is isolated, so one unwritable directory fails
 * only its own entry while its siblings still apply.
 */
async function fanoutSkills(
  targetDirs: readonly HostPath[],
  intermediate: string,
  enabled: readonly string[],
  context: Context,
): Promise<LinkFanout> {
  let changed = false;
  const failed: StepReport[] = [];
  for (const dir of targetDirs) {
    const root = resolveHostPath(dir, context.home);
    const desired = enabled.map((name) => ({
      path: join(root, name),
      target: join(intermediate, name),
    }));
    try {
      if (await reconcileManagedLinks(root, [`${intermediate}/`], desired)) {
        changed = true;
      }
    } catch (error) {
      failed.push({
        key: symbolic(dir),
        value: 'link failed',
        status: 'failed',
        error: errorMessage(error),
      });
    }
  }
  return { changed, failed };
}

/**
 * The kind-specific half of a coder activation. `read` parses the deployed
 * catalog; `apply` builds the intermediate output once and fans it out. Read and
 * build failures throw (a whole-activation failure); fan-out failures are
 * isolated into `LinkFanout.failed`.
 */
interface CoderSpec {
  readonly base: Described;
  readonly prefix: string;
  readonly manifestPath: string;
  read(sourceDir: string): Promise<readonly string[]>;
  apply(sourceDir: string, enabled: readonly string[]): Promise<LinkFanout>;
}

async function runCoder(
  context: Context,
  spec: CoderSpec,
): Promise<ActivationReport> {
  return guarded(spec.base, async () => {
    const sourceDir = deployedDir(spec.prefix, context.home);
    const catalog = await spec.read(sourceDir);
    const disabled = await readDisabled(spec.manifestPath);
    const { enabled, unknown } = resolveSelection(catalog, disabled, 'opt-out');
    const { changed, failed } = await spec.apply(sourceDir, enabled);
    const entries = [...staleManifestEntries(unknown), ...failed];
    const status =
      failed.length > 0 ? 'failed' : changed ? 'changed' : 'unchanged';
    return entries.length > 0
      ? { ...spec.base, status, entries }
      : { ...spec.base, status };
  });
}

export function runCoderAgents(
  activation: CoderAgentsActivation,
  context: Context,
): Promise<ActivationReport> {
  return runCoder(context, {
    base: describeCoderAgents(activation),
    prefix: activation.sectionsPrefix,
    manifestPath: agentsManifest(context.home),
    read: readSections,
    async apply(sourceDir, enabled) {
      const output = agentsFile(context.home);
      const built = await buildAgents(sourceDir, enabled, output);
      const fanout = await fanoutFile(activation.dests, output, context);
      return { changed: built || fanout.changed, failed: fanout.failed };
    },
  });
}

export function runCoderSkills(
  activation: CoderSkillsActivation,
  context: Context,
): Promise<ActivationReport> {
  return runCoder(context, {
    base: describeCoderSkills(activation),
    prefix: activation.skillsPrefix,
    manifestPath: skillsManifest(context.home),
    read: readSkills,
    async apply(sourceDir, enabled) {
      const intermediate = skillsDir(context.home);
      const built = await buildSkills(sourceDir, enabled, intermediate);
      const fanout = await fanoutSkills(
        activation.targetDirs,
        intermediate,
        enabled,
        context,
      );
      return { changed: built || fanout.changed, failed: fanout.failed };
    },
  });
}
