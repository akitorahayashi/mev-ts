import { deployedDir } from '../assets/ref';
import { toggle } from '../cli/tty/toggle';
import { readSections, readSkills } from '../provisioning/coder/catalog';
import {
  readDisabled,
  resolve,
  writeDisabled,
} from '../provisioning/coder/manifest';
import {
  AGENTS_SECTIONS_PREFIX,
  agentsManifest,
  SKILLS_PREFIX,
  skillsManifest,
} from '../provisioning/coder/paths';

export type CoderSelectable = 'agents' | 'skills';

function catalogReader(kind: CoderSelectable) {
  return kind === 'agents' ? readSections : readSkills;
}

function manifestPath(kind: CoderSelectable, home: string): string {
  return kind === 'agents' ? agentsManifest(home) : skillsManifest(home);
}

function sourceDir(kind: CoderSelectable, home: string): string {
  return deployedDir(
    kind === 'agents' ? AGENTS_SECTIONS_PREFIX : SKILLS_PREFIX,
    home,
  );
}

function selectMessage(kind: CoderSelectable): string {
  return kind === 'agents'
    ? 'Select enabled AGENTS.md sections'
    : 'Select enabled skills';
}

export async function configSelect(
  kind: CoderSelectable,
  home: string,
  warn: (message: string) => void,
): Promise<void> {
  const catalog = await catalogReader(kind)(sourceDir(kind, home));
  const manifest = manifestPath(kind, home);
  const disabled = await readDisabled(manifest);
  const { enabled, unknownDisabled } = resolve(catalog, disabled);
  if (unknownDisabled.length > 0) {
    warn(
      `warning: manifest names not in catalog: ${unknownDisabled.join(', ')}\n`,
    );
  }

  const chosen = await toggle(selectMessage(kind), catalog, enabled);
  if (chosen === null) return;

  const newDisabled = catalog.filter((n) => !chosen.includes(n));
  await writeDisabled(manifest, newDisabled);
}

export async function configSelectClear(
  kind: CoderSelectable,
  home: string,
): Promise<void> {
  const catalog = await catalogReader(kind)(sourceDir(kind, home));
  await writeDisabled(manifestPath(kind, home), catalog);
}
