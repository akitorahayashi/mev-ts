import { ProvisioningError } from '../../errors';
import type { CommandRunner } from '../../resources/model';

export interface Label {
  readonly name: string;
  readonly color: string;
  readonly description: string;
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
      `gh label list failed with code ${result.code}: ${result.stderr || result.stdout || 'unknown error'}`,
    );
  }
  const parsed = JSON.parse(result.stdout) as Array<{ name: string }>;
  return parsed.map((l) => l.name);
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
      `gh label create ${label.name} failed with code ${result.code}: ${result.stderr || result.stdout || 'unknown error'}`,
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
      `gh label edit ${label.name} failed with code ${result.code}: ${result.stderr || result.stdout || 'unknown error'}`,
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
      `gh label delete ${name} failed with code ${result.code}: ${result.stderr || result.stdout || 'unknown error'}`,
    );
  }
}
