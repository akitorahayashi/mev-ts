import { errorMessage, ProvisioningError } from '../../errors';
import type { CommandRunner } from '../../host/command';
import { runStep } from './run';

export interface Label {
  readonly name: string;
  readonly color: string;
  readonly description: string;
}

function isLabelName(value: unknown): value is { readonly name: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as { readonly name?: unknown }).name === 'string'
  );
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
  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout);
  } catch (error) {
    throw new ProvisioningError(
      `Failed to parse gh label list output: ${errorMessage(error)}`,
    );
  }
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

export async function createLabel(
  run: CommandRunner,
  label: Label,
  repo?: string,
): Promise<void> {
  await runStep(
    run,
    [
      'label',
      'create',
      label.name,
      '--color',
      label.color,
      '--description',
      label.description,
      ...repoArgs(repo),
    ],
    `gh label create ${label.name} failed`,
  );
}

export async function editLabel(
  run: CommandRunner,
  label: Label,
  repo?: string,
): Promise<void> {
  await runStep(
    run,
    [
      'label',
      'edit',
      label.name,
      '--color',
      label.color,
      '--description',
      label.description,
      ...repoArgs(repo),
    ],
    `gh label edit ${label.name} failed`,
  );
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
