import { ProvisioningError } from '../../errors';
import type { CommandRunner } from '../../host/command';
import { isRecord, parseJsonLabeled } from '../../host/parse';
import { runStep } from './run';

export interface Label {
  readonly name: string;
  readonly color: string;
  readonly description: string;
}

function isLabelName(value: unknown): value is { readonly name: string } {
  return isRecord(value) && typeof value['name'] === 'string';
}

function repoArgs(repo?: string): string[] {
  return repo ? ['--repo', repo] : [];
}

export async function listLabelNames(
  run: CommandRunner,
  repo?: string,
): Promise<string[]> {
  const result = await runStep(
    run,
    ['label', 'list', '--json', 'name', '--limit', '1000', ...repoArgs(repo)],
    'gh label list failed',
  );
  const parsed = parseJsonLabeled(result.stdout, 'gh label list output');
  if (!Array.isArray(parsed)) {
    throw new ProvisioningError(
      'Failed to parse gh label list output: expected an array',
    );
  }
  if (!parsed.every(isLabelName)) {
    throw new ProvisioningError(
      'Failed to parse gh label list output: every entry must contain a string name',
    );
  }
  return parsed.map((label) => label.name);
}

async function writeLabel(
  run: CommandRunner,
  verb: 'create' | 'edit',
  label: Label,
  repo?: string,
): Promise<void> {
  await runStep(
    run,
    [
      'label',
      verb,
      label.name,
      '--color',
      label.color,
      '--description',
      label.description,
      ...repoArgs(repo),
    ],
    `gh label ${verb} ${label.name} failed`,
  );
}

export function createLabel(
  run: CommandRunner,
  label: Label,
  repo?: string,
): Promise<void> {
  return writeLabel(run, 'create', label, repo);
}

export function editLabel(
  run: CommandRunner,
  label: Label,
  repo?: string,
): Promise<void> {
  return writeLabel(run, 'edit', label, repo);
}

export async function deleteLabel(
  run: CommandRunner,
  name: string,
  repo?: string,
): Promise<void> {
  await runStep(
    run,
    ['label', 'delete', name, '--yes', ...repoArgs(repo)],
    `gh label delete ${name} failed`,
  );
}
