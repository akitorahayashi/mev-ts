import type { CommandRunner } from '../../resources/model';
import {
  createLabel,
  deleteLabel,
  editLabel,
  type Label,
  listLabelNames,
} from './label';

export const LABEL_CATALOG: readonly Label[] = [
  { name: 'C-bugs', description: "Something isn't working", color: 'd73a4a' },
  {
    name: 'C-feats',
    description: 'A new feature or functional specification change',
    color: 'd93f0b',
  },
  {
    name: 'C-refacts',
    description:
      'Internal code optimization or architectural improvement without specification changes',
    color: '0e8a16',
  },
  {
    name: 'C-tests',
    description: 'Adding missing tests or correcting existing tests',
    color: '5319e7',
  },
  {
    name: 'C-docs',
    description: 'Documentation only changes',
    color: '0075ca',
  },
  {
    name: 'C-tooling',
    description:
      'Changes to development tools, hooks, or workspace configurations',
    color: '7c2fa0',
  },
  {
    name: 'C-ci',
    description: 'Continuous integration changes',
    color: '1d76db',
  },
  {
    name: 'C-security',
    description: 'Security-related changes or vulnerability fixes',
    color: '9a596e',
  },
  { name: 'jules', description: 'Assign tasks to Jules', color: '453ced' },
  {
    name: 'S-review-requested',
    description: 'Code review requested',
    color: 'b55501',
  },
  {
    name: 'S-required-planning',
    description: 'Implementation plan required',
    color: '006b75',
  },
  {
    name: 'S-implementation-ready',
    description: 'Ready for implementation',
    color: '4e0b78',
  },
  { name: 'S-required-checks', description: 'Check required', color: 'f7379a' },
  { name: 'S-checked', description: 'Checked', color: '0052cc' },
  { name: 'P-high', description: 'Immediate action required', color: 'b60205' },
  { name: 'P-low', description: 'Investment for the future', color: '725d81' },
];

export async function deployLabels(
  run: CommandRunner,
  repo?: string,
): Promise<void> {
  const existing = new Set(await listLabelNames(run, repo));
  for (const label of LABEL_CATALOG) {
    if (existing.has(label.name)) {
      await editLabel(run, label, repo);
    } else {
      await createLabel(run, label, repo);
    }
  }
}

export async function resetLabels(
  run: CommandRunner,
  repo?: string,
): Promise<void> {
  const names = await listLabelNames(run, repo);
  for (const name of names) {
    await deleteLabel(run, name, repo);
  }
}
