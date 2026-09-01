import { join } from 'node:path';
import { deployedDir } from '../../assets/ref';
import { buildAgents } from '../../coder/agents';
import { readSections, readSkills } from '../../coder/catalog';
import { catalogSelection } from '../../coder/manifest';
import {
  agentsFile,
  agentsManifest,
  skillsDir,
  skillsManifest,
} from '../../coder/paths';
import { buildSkills } from '../../coder/skills';
import { errorMessage } from '../../errors';
import type { Context } from '../../host/context';
import { reconcileManagedLinks } from '../../host/managed-links';
import { type HostPath, resolveHostPath, symbolic } from '../../host/path';
import { isSymlinkTo, placeSymlink } from '../../host/symlink';
import type {
  Activation,
  ActivationDescription,
  ActivationReport,
  ReconcileItemResult,
} from './contract';
import { activationReport, guarded, stepOutcome } from './reconcile';

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
  _activation: CoderAgentsActivation,
): ActivationDescription {
  return {
    subject: 'agent instructions',
    unchangedCollection: 'agent instruction files',
  };
}

export function describeCoderSkills(
  _activation: CoderSkillsActivation,
): ActivationDescription {
  return {
    subject: 'agent skills',
    unchangedCollection: 'agent skill links',
  };
}

interface LinkFanout {
  readonly entries: readonly ReconcileItemResult[];
}

/** Symlink `target` into each dest, isolating a per-dest failure to its entry. */
async function fanoutFile(
  dests: readonly HostPath[],
  target: string,
  context: Context,
): Promise<LinkFanout> {
  const entries: ReconcileItemResult[] = [];
  for (const dest of dests) {
    const link = resolveHostPath(dest, context.home);
    try {
      if (await isSymlinkTo(link, target)) {
        entries.push({
          key: symbolic(dest),
          value: 'managed link already current',
          status: 'unchanged',
        });
      } else {
        await placeSymlink(link, target);
        entries.push({
          key: symbolic(dest),
          value: 'managed link updated',
          status: 'changed',
        });
      }
    } catch (error) {
      entries.push({
        key: symbolic(dest),
        value: 'link failed',
        status: 'failed',
        error: errorMessage(error),
      });
    }
  }
  return { entries };
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
  const entries: ReconcileItemResult[] = [];
  for (const dir of targetDirs) {
    const root = resolveHostPath(dir, context.home);
    const desired = enabled.map((name) => ({
      path: join(root, name),
      target: join(intermediate, name),
    }));
    try {
      const result = await reconcileManagedLinks(
        root,
        [`${intermediate}/`],
        desired,
      );
      entries.push({
        key: symbolic(dir),
        value: result.changed
          ? 'managed links updated'
          : 'managed links already current',
        status: result.changed ? 'changed' : 'unchanged',
      });
    } catch (error) {
      entries.push({
        key: symbolic(dir),
        value: 'link failed',
        status: 'failed',
        error: errorMessage(error),
      });
    }
  }
  return { entries };
}

function includeGeneratedChanges(
  fanout: LinkFanout,
  generatedChanged: boolean,
): LinkFanout {
  if (!generatedChanged) return fanout;
  return {
    entries: fanout.entries.map((entry) =>
      entry.status === 'failed'
        ? entry
        : {
            ...entry,
            value: 'generated content or managed links updated',
            status: 'changed',
          },
    ),
  };
}

/**
 * The kind-specific half of a coder activation. `read` parses the deployed
 * catalog; `apply` builds the intermediate output once and fans it out. Read and
 * build failures throw (a whole-activation failure); fan-out failures are
 * isolated into per-destination fan-out results.
 */
interface CoderSpec {
  readonly base: ActivationDescription;
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
    const { enabled, unknown } = await catalogSelection.resolve(
      catalog,
      spec.manifestPath,
    );
    const { entries } = await spec.apply(sourceDir, enabled);
    return activationReport(
      spec.base,
      entries.map(stepOutcome),
      unknown.map((name) => `Ignored stale disabled selection: ${name}`),
    );
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
      return includeGeneratedChanges(fanout, built);
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
      return includeGeneratedChanges(fanout, built);
    },
  });
}
