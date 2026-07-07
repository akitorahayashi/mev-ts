import { errorMessage, ProvisioningError } from '../../errors';
import { type CommandRunner, formatCommandFailure } from '../../host/command';

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
  const result = await run.run('gh', [
    'label',
    'list',
    '--json',
    'name',
    '--limit',
    '1000',
    ...repoArgs(repo),
  ]);
  if (result.code !== 0) {
    throw new ProvisioningError(
      formatCommandFailure('gh label list failed', result),
    );
  }
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
  const result = await run.run('gh', [
    'label',
    'create',
    label.name,
    '--color',
    label.color,
    '--description',
    label.description,
    ...repoArgs(repo),
  ]);
  if (result.code !== 0) {
    throw new ProvisioningError(
      formatCommandFailure(`gh label create ${label.name} failed`, result),
    );
  }
}

export async function editLabel(
  run: CommandRunner,
  label: Label,
  repo?: string,
): Promise<void> {
  const result = await run.run('gh', [
    'label',
    'edit',
    label.name,
    '--color',
    label.color,
    '--description',
    label.description,
    ...repoArgs(repo),
  ]);
  if (result.code !== 0) {
    throw new ProvisioningError(
      formatCommandFailure(`gh label edit ${label.name} failed`, result),
    );
  }
}

export async function deleteLabel(
  run: CommandRunner,
  name: string,
  repo?: string,
): Promise<void> {
  const result = await run.run('gh', [
    'label',
    'delete',
    name,
    '--yes',
    ...repoArgs(repo),
  ]);
  if (result.code !== 0) {
    throw new ProvisioningError(
      formatCommandFailure(`gh label delete ${name} failed`, result),
    );
  }
}
