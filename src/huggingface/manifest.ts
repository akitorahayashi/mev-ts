import { ProvisioningError } from '../errors';
import {
  requireExactKeys,
  requireRecord,
  requireStringArray,
  requireUniqueBy,
} from '../host/parse';
import { loadYaml } from '../host/yaml';

export type ModelEntry = {
  readonly action: 'install' | 'uninstall';
  readonly repo: string;
};

export function requireRepoId(value: string, label: string): string {
  const component = '[A-Za-z0-9_](?:[A-Za-z0-9._-]*[A-Za-z0-9_])?';
  if (
    !new RegExp(`^(?:${component}/)?${component}$`).test(value) ||
    value.includes('..') ||
    value.includes('--') ||
    value.endsWith('.git')
  ) {
    throw new ProvisioningError(
      `${label} must be a valid Hugging Face model ID.`,
    );
  }
  return value;
}

export function parseManifest(raw: string, path: string): ModelEntry[] {
  const label = `Hugging Face models ${path}`;
  const parsed = requireRecord(loadYaml(raw, path), label);
  requireExactKeys(parsed, ['models', 'uninstall'], label);
  const models = requireStringArray(parsed['models'], `${label} models`);
  const uninstall =
    parsed['uninstall'] === undefined
      ? []
      : requireStringArray(parsed['uninstall'], `${label} uninstall`);
  const repos = [...models, ...uninstall];
  for (const repo of repos) requireRepoId(repo, `${label} '${repo}'`);
  requireUniqueBy(repos, (repo) => repo, label);
  return [
    ...uninstall.map((repo) => ({ action: 'uninstall', repo }) as const),
    ...models.map((repo) => ({ action: 'install', repo }) as const),
  ];
}
