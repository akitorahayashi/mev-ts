import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import {
  type AssetRef,
  asset,
  deployedDir,
  deployedPath,
  deployedSymbolic,
} from '../../assets/ref';
import {
  lstatIfPresent,
  readDirectoryIfPresent,
  readlinkIfPresent,
} from '../../host/absence';
import type { Context } from '../../host/context';
import { type HostPath, resolveHostPath, symbolic } from '../../host/path';
import { isSymlinkTo, placeSymlink } from '../../host/symlink';
import {
  type Activation,
  type ActivationReport,
  type Described,
  errorMessage,
} from './contract';

type FileActivation = Extract<Activation, { kind: 'file' }>;
type TreeActivation = Extract<Activation, { kind: 'tree' }>;

export function link(source: AssetRef, dest: HostPath): Activation {
  return { kind: 'file', source, dest };
}

export function linkTree(prefix: string, dest: HostPath): Activation {
  return { kind: 'tree', prefix, dest };
}

export function describeFile(activation: FileActivation): Described {
  return {
    verb: 'link',
    source: deployedSymbolic(activation.source),
    dest: symbolic(activation.dest),
  };
}

export function describeTree(activation: TreeActivation): Described {
  return {
    verb: 'link',
    source: deployedSymbolic({ key: activation.prefix }),
    dest: symbolic(activation.dest),
  };
}

interface TreeEntry {
  readonly link: string;
  readonly target: string;
}

function treeEntries(
  refs: readonly AssetRef[],
  prefix: string,
  root: string,
  home: string,
): TreeEntry[] {
  return refs.map((ref) => ({
    link: join(root, ref.key.slice(prefix.length)),
    target: deployedPath(ref, home),
  }));
}

async function staleLinks(
  root: string,
  managedRoot: string,
  expected: ReadonlySet<string>,
): Promise<string[]> {
  const names = await readDirectoryIfPresent(root);
  if (names === null) {
    return [];
  }
  const base = managedRoot.endsWith('/') ? managedRoot : `${managedRoot}/`;
  const stale: string[] = [];
  for (const name of names) {
    const path = join(root, name);
    if (expected.has(path)) {
      continue;
    }
    const stats = await lstatIfPresent(path);
    if (!stats?.isSymbolicLink()) {
      continue;
    }
    const target = await readlinkIfPresent(path);
    if (target?.startsWith(base)) {
      stale.push(path);
    }
  }
  return stale;
}

export async function runFile(
  activation: FileActivation,
  context: Context,
): Promise<ActivationReport> {
  const base = describeFile(activation);
  try {
    const link = resolveHostPath(activation.dest, context.home);
    const target = deployedPath(activation.source, context.home);
    if (await isSymlinkTo(link, target)) {
      return { ...base, status: 'unchanged' };
    }
    await placeSymlink(link, target, context.overwrite);
    return { ...base, status: 'changed' };
  } catch (error) {
    return { ...base, status: 'failed', error: errorMessage(error) };
  }
}

export async function runTree(
  activation: TreeActivation,
  context: Context,
): Promise<ActivationReport> {
  const base = describeTree(activation);
  try {
    const refs = context.assets
      .keysByPrefix(activation.prefix)
      .map((key) => asset(key));
    const root = resolveHostPath(activation.dest, context.home);
    const managedRoot = deployedDir(activation.prefix, context.home);
    const entries = treeEntries(refs, activation.prefix, root, context.home);

    const drifted: TreeEntry[] = [];
    for (const { link, target } of entries) {
      if (await isSymlinkTo(link, target)) {
        continue;
      }
      drifted.push({ link, target });
    }
    const expected = new Set(entries.map((entry) => entry.link));
    const stale = await staleLinks(root, managedRoot, expected);

    if (drifted.length === 0 && stale.length === 0) {
      return { ...base, status: 'unchanged' };
    }

    for (const { link, target } of drifted) {
      await placeSymlink(link, target, context.overwrite);
    }
    for (const link of stale) {
      await rm(link, { force: true });
    }
    return { ...base, status: 'changed' };
  } catch (error) {
    return { ...base, status: 'failed', error: errorMessage(error) };
  }
}
