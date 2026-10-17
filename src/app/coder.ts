import { deployedDir } from '../assets/ref';
import { readSections, readSkills } from '../coder/catalog';
import { catalogSelection } from '../coder/manifest';
import {
  AGENTS_SECTIONS_PREFIX,
  agentsManifest,
  SKILLS_PREFIX,
  skillsManifest,
} from '../coder/paths';
import type { SelectionInput } from '../provisioning/target';
import {
  type ConfigToggleSurface,
  configClearManifest,
  configSelectManifest,
  type SelectEntries,
} from './config-toggle';
import { withHomeMutation } from './mutation';

type CoderSelectable = 'agents' | 'skills';

interface CoderDescriptor {
  readonly input: SelectionInput;
  readonly read: (sourceDir: string) => Promise<string[]>;
  readonly manifest: (home: string) => string;
  readonly prefix: string;
  readonly message: string;
}

/** One record per selectable, replacing the parallel per-field ternaries. */
const DESCRIPTORS: Record<CoderSelectable, CoderDescriptor> = {
  agents: {
    input: 'coderAgents',
    read: readSections,
    manifest: agentsManifest,
    prefix: AGENTS_SECTIONS_PREFIX,
    message: 'Select enabled AGENTS.md sections',
  },
  skills: {
    input: 'coderSkills',
    read: readSkills,
    manifest: skillsManifest,
    prefix: SKILLS_PREFIX,
    message: 'Select enabled skills',
  },
};

async function coderSelection(
  kind: CoderSelectable,
  home: string,
): Promise<ConfigToggleSurface> {
  const descriptor = DESCRIPTORS[kind];
  return {
    home,
    input: descriptor.input,
    catalog: await descriptor.read(deployedDir(descriptor.prefix, home)),
    manifestPath: descriptor.manifest(home),
    message: descriptor.message,
    policy: catalogSelection,
  };
}

export async function configSelect(
  kind: CoderSelectable,
  home: string,
  warn: (message: string) => void,
  select: SelectEntries,
): Promise<void> {
  await withHomeMutation(home, `config ${kind}`, async () =>
    configSelectManifest(await coderSelection(kind, home), warn, select),
  );
}

export async function configSelectClear(
  kind: CoderSelectable,
  home: string,
): Promise<void> {
  await withHomeMutation(home, `config ${kind} --clear`, async () =>
    configClearManifest(await coderSelection(kind, home)),
  );
}
