import { createHash } from 'node:crypto';
import type { BigIntStats } from 'node:fs';
import { lstat, readdir, readFile, readlink } from 'node:fs/promises';
import { join } from 'node:path';
import { ProvisioningError } from '../errors';
import { isNotFound } from './absence';

export interface EntryIdentity {
  readonly dev: string;
  readonly ino: string;
  readonly birthtimeNs: string;
}

interface EntryAttributes {
  readonly identity: EntryIdentity;
  readonly mode: number;
}

export type EntrySnapshot = EntryAttributes &
  (
    | {
        readonly kind: 'directory';
        readonly children: readonly {
          readonly name: string;
          readonly entry: EntrySnapshot;
        }[];
      }
    | {
        readonly kind: 'file';
        readonly mtimeNs: string;
        readonly digest: string;
      }
    | {
        readonly kind: 'symlink';
        readonly mtimeNs: string;
        readonly target: string;
      }
  );

export async function entryIdentity(
  path: string,
): Promise<EntryIdentity | null> {
  try {
    const stats = await lstat(path, { bigint: true });
    return {
      dev: String(stats.dev),
      ino: String(stats.ino),
      birthtimeNs: String(stats.birthtimeNs),
    };
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

export function sameIdentity(
  left: EntryIdentity | null,
  right: EntryIdentity | null,
): boolean {
  return left === null || right === null
    ? left === right
    : left.dev === right.dev &&
        left.ino === right.ino &&
        left.birthtimeNs === right.birthtimeNs;
}

export async function snapshotEntry(
  path: string,
): Promise<EntrySnapshot | null> {
  let stats: BigIntStats;
  try {
    stats = await lstat(path, { bigint: true });
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
  const attributes = {
    identity: {
      dev: String(stats.dev),
      ino: String(stats.ino),
      birthtimeNs: String(stats.birthtimeNs),
    },
    mode: Number(stats.mode & 0o7777n),
  };
  if (stats.isSymbolicLink())
    return {
      ...attributes,
      kind: 'symlink',
      mtimeNs: String(stats.mtimeNs),
      target: await readlink(path),
    };
  if (stats.isFile())
    return {
      ...attributes,
      kind: 'file',
      mtimeNs: String(stats.mtimeNs),
      digest: createHash('sha256')
        .update(await readFile(path))
        .digest('hex'),
    };
  if (stats.isDirectory()) {
    const children: { name: string; entry: EntrySnapshot }[] = [];
    for (const name of (await readdir(path)).sort()) {
      const entry = await snapshotEntry(join(path, name));
      if (!entry)
        throw new ProvisioningError(
          `Resource changed during transaction inspection: ${join(path, name)}.`,
        );
      children.push({ name, entry });
    }
    return { ...attributes, kind: 'directory', children };
  }
  throw new ProvisioningError(
    `Unsupported transaction entry at ${path}; retained state requires inspection.`,
  );
}

export function matchesSnapshot(
  actual: EntrySnapshot | null,
  expected: EntrySnapshot | null,
  allowRemoved = false,
): boolean {
  if (actual === null) return expected === null || allowRemoved;
  if (
    expected === null ||
    actual.kind !== expected.kind ||
    actual.mode !== expected.mode ||
    !sameIdentity(actual.identity, expected.identity)
  )
    return false;
  if (actual.kind === 'file' && expected.kind === 'file')
    return (
      actual.mtimeNs === expected.mtimeNs && actual.digest === expected.digest
    );
  if (actual.kind === 'symlink' && expected.kind === 'symlink')
    return (
      actual.mtimeNs === expected.mtimeNs && actual.target === expected.target
    );
  if (actual.kind !== 'directory' || expected.kind !== 'directory')
    return false;
  if (!allowRemoved && actual.children.length !== expected.children.length)
    return false;
  const expectedByName = new Map(
    expected.children.map((child) => [child.name, child.entry]),
  );
  return actual.children.every((child) => {
    const previous = expectedByName.get(child.name);
    return (
      previous !== undefined &&
      matchesSnapshot(child.entry, previous, allowRemoved)
    );
  });
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function isEntryIdentity(value: unknown): value is EntryIdentity {
  return (
    record(value) &&
    Object.keys(value).sort().join(',') === 'birthtimeNs,dev,ino' &&
    ['birthtimeNs', 'dev', 'ino'].every(
      (key) => typeof value[key] === 'string' && /^\d+$/.test(value[key]),
    )
  );
}

export function isEntrySnapshot(
  value: unknown,
  depth = 0,
): value is EntrySnapshot {
  if (
    depth > 256 ||
    !record(value) ||
    !isEntryIdentity(value['identity']) ||
    !Number.isInteger(value['mode']) ||
    Number(value['mode']) < 0 ||
    Number(value['mode']) > 0o7777
  )
    return false;
  const keys = Object.keys(value).sort().join(',');
  if (value['kind'] === 'file')
    return (
      keys === 'digest,identity,kind,mode,mtimeNs' &&
      typeof value['digest'] === 'string' &&
      /^[0-9a-f]{64}$/.test(value['digest']) &&
      typeof value['mtimeNs'] === 'string' &&
      /^\d+$/.test(value['mtimeNs'])
    );
  if (value['kind'] === 'symlink')
    return (
      keys === 'identity,kind,mode,mtimeNs,target' &&
      typeof value['target'] === 'string' &&
      typeof value['mtimeNs'] === 'string' &&
      /^\d+$/.test(value['mtimeNs'])
    );
  if (
    value['kind'] !== 'directory' ||
    keys !== 'children,identity,kind,mode' ||
    !Array.isArray(value['children'])
  )
    return false;
  const names = new Set<string>();
  return value['children'].every((child: unknown) => {
    if (
      !record(child) ||
      Object.keys(child).sort().join(',') !== 'entry,name' ||
      typeof child['name'] !== 'string' ||
      !child['name'] ||
      child['name'] === '.' ||
      child['name'] === '..' ||
      /[/\0]/.test(child['name']) ||
      names.has(child['name'])
    )
      return false;
    names.add(child['name']);
    return isEntrySnapshot(child['entry'], depth + 1);
  });
}
