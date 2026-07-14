import { deployedDir } from '../assets/ref';
import { readSections, readSkills } from '../provisioning/coder/catalog';
import { readDisabled, writeDisabled } from '../provisioning/coder/manifest';
import {
  AGENTS_SECTIONS_PREFIX,
  agentsManifest,
  SKILLS_PREFIX,
  skillsManifest,
} from '../provisioning/coder/paths';
import {
  type ConfigSelection,
  configClearManifest,
  configSelectManifest,
  type SelectEntries,
} from './config-selection';

export type CoderSelectable = 'agents' | 'skills';

interface CoderDescriptor {
  readonly read: (sourceDir: string) => Promise<string[]>;
  readonly manifest: (home: string) => string;
  readonly prefix: string;
  readonly message: string;
}

/** One record per selectable, replacing the parallel per-field ternaries. */
const DESCRIPTORS: Record<CoderSelectable, CoderDescriptor> = {
  agents: {
    read: readSections,
    manifest: agentsManifest,
    prefix: AGENTS_SECTIONS_PREFIX,
    message: 'Select enabled AGENTS.md sections',
  },
  skills: {
    read: readSkills,
    manifest: skillsManifest,
    prefix: SKILLS_PREFIX,
    message: 'Select enabled skills',
  },
};

async function coderSelection(
  kind: CoderSelectable,
  home: string,
): Promise<ConfigSelection> {
  const descriptor = DESCRIPTORS[kind];
  const manifest = descriptor.manifest(home);
  return {
    catalog: await descriptor.read(deployedDir(descriptor.prefix, home)),
    read: () => readDisabled(manifest),
    write: (names) => writeDisabled(manifest, names),
    message: descriptor.message,
    mode: 'opt-out',
  };
}

export async function configSelect(
  kind: CoderSelectable,
  home: string,
  warn: (message: string) => void,
  select: SelectEntries,
): Promise<void> {
  await configSelectManifest(await coderSelection(kind, home), warn, select);
}

export async function configSelectClear(
  kind: CoderSelectable,
  home: string,
): Promise<void> {
  await configClearManifest(await coderSelection(kind, home));
}
