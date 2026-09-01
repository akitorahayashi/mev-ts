import { lstat, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { deployedDir } from '../assets/ref';
import { lstatIfPresent } from '../host/absence';
import type { AssetIntent } from './signature';

export interface RoleAssetChange {
  readonly key: string;
  readonly kind: 'added' | 'updated' | 'removed';
}

type RoleEntry =
  | { readonly kind: 'directory'; readonly path: string }
  | {
      readonly kind: 'file';
      readonly path: string;
      readonly content: Buffer;
      readonly executable: boolean;
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
      executable: intent.executable,
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
    if (child.isDirectory()) {
      entries.push({ kind: 'directory', path });
      await walkDeployed(root, path, entries);
    } else if (child.isFile()) {
      const [content, stats] = await Promise.all([
        readFile(absolute),
        lstat(absolute),
      ]);
      entries.push({
        kind: 'file',
        path,
        content,
        executable: (stats.mode & 0o111) !== 0,
      });
    } else {
      entries.push({ kind: 'other', path });
    }
  }
}

async function deployedEntries(
  role: string,
  home: string,
): Promise<RoleEntry[]> {
  const root = deployedDir(role, home);
  const stats = await lstatIfPresent(root);
  if (stats === null) return [];
  if (!stats.isDirectory()) return [{ kind: 'other', path: '' }];
  const entries: RoleEntry[] = [];
  await walkDeployed(root, '', entries);
  return entries;
}

function equivalent(left: RoleEntry, right: RoleEntry): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind !== 'file' || right.kind !== 'file') return true;
  return (
    left.content.equals(right.content) && left.executable === right.executable
  );
}

export async function roleAssetChanges(
  role: string,
  intents: readonly AssetIntent[],
  home: string,
): Promise<RoleAssetChange[]> {
  const expected = embeddedEntries(role, intents);
  const actual = await deployedEntries(role, home);
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
  return changes.sort((left, right) => left.key.localeCompare(right.key));
}
