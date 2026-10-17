import { lstat, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { deployedDir } from '../assets/ref';
import { lstatIfPresent } from '../host/absence';
import type { AssetIntent } from './signature';

export interface RoleAssetChange {
  readonly key: string;
  readonly kind: 'added' | 'updated' | 'removed';
}

export interface RoleComparison {
  readonly changes: readonly RoleAssetChange[];
  readonly deploymentCurrent: boolean;
}

type RoleEntry =
  | { readonly kind: 'directory'; readonly path: string }
  | {
      readonly kind: 'file';
      readonly path: string;
      readonly content: Buffer;
      readonly executeMask: number;
    }
  | { readonly kind: 'other'; readonly path: string };

function embeddedEntries(
  role: string,
  intents: readonly AssetIntent[],
): RoleEntry[] {
  const prefix = `${role}/`;
  const directories = new Set<string>();
  const files = intents.map((intent): RoleEntry => {
    const path = intent.key.slice(prefix.length);
    const parts = path.split('/');
    for (let index = 1; index < parts.length; index += 1) {
      directories.add(parts.slice(0, index).join('/'));
    }
    return {
      kind: 'file',
      path,
      content: Buffer.from(intent.content),
      executeMask: intent.executable ? 0o111 : 0,
    };
  });
  return [
    ...[...directories].map((path): RoleEntry => ({ kind: 'directory', path })),
    ...files,
  ];
}

async function walkDeployed(
  root: string,
  relative: string,
  entries: RoleEntry[],
): Promise<void> {
  const directory = relative === '' ? root : join(root, relative);
  const children = await readdir(directory, { withFileTypes: true });
  children.sort((left, right) => left.name.localeCompare(right.name));
  for (const child of children) {
    const path = relative === '' ? child.name : join(relative, child.name);
    const absolute = join(root, path);
    const stats = await lstat(absolute);
    if (stats.isDirectory()) {
      entries.push({ kind: 'directory', path });
      await walkDeployed(root, path, entries);
    } else if (stats.isFile()) {
      entries.push({
        kind: 'file',
        path,
        content: await readFile(absolute),
        executeMask: stats.mode & 0o111,
      });
    } else {
      entries.push({ kind: 'other', path });
    }
  }
}

async function deployedEntries(
  role: string,
  home: string,
): Promise<{ readonly entries: RoleEntry[]; readonly absent: boolean }> {
  const root = deployedDir(role, home);
  const stats = await lstatIfPresent(root);
  if (stats === null) return { entries: [], absent: true };
  if (!stats.isDirectory())
    return { entries: [{ kind: 'other', path: '' }], absent: false };
  const entries: RoleEntry[] = [];
  await walkDeployed(root, '', entries);
  return { entries, absent: false };
}

function equivalent(left: RoleEntry, right: RoleEntry): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind !== 'file' || right.kind !== 'file') return true;
  return (
    left.content.equals(right.content) &&
    (left.executeMask !== 0) === (right.executeMask !== 0)
  );
}

export async function compareRole(
  role: string,
  intents: readonly AssetIntent[],
  home: string,
): Promise<RoleComparison> {
  const expected = embeddedEntries(role, intents);
  const { entries: actual, absent } = await deployedEntries(role, home);
  const expectedByPath = new Map(expected.map((entry) => [entry.path, entry]));
  const actualByPath = new Map(actual.map((entry) => [entry.path, entry]));
  const changes: RoleAssetChange[] = [];

  for (const entry of expected) {
    const current = actualByPath.get(entry.path);
    if (!current) {
      changes.push({
        key: `${role}/${entry.path}${entry.kind === 'directory' ? '/' : ''}`,
        kind: 'added',
      });
    } else if (!equivalent(entry, current)) {
      changes.push({
        key: `${role}/${entry.path}${entry.kind === 'directory' ? '/' : ''}`,
        kind: 'updated',
      });
    }
  }
  for (const entry of actual) {
    if (expectedByPath.has(entry.path)) continue;
    changes.push({
      key: `${role}/${entry.path}${entry.kind === 'directory' ? '/' : ''}`,
      kind: 'removed',
    });
  }
  const deploymentCurrent =
    changes.length === 0 &&
    (!absent || intents.length === 0) &&
    expected.every((entry) => {
      if (entry.kind !== 'file') return true;
      const current = actualByPath.get(entry.path);
      return (
        current?.kind === 'file' && current.executeMask === entry.executeMask
      );
    });
  return {
    changes: changes.sort((left, right) => left.key.localeCompare(right.key)),
    deploymentCurrent,
  };
}
