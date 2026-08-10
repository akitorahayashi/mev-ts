import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  type AssetRef,
  asset,
  deployedDir,
  deployedPath,
  deployedSymbolic,
} from '../../assets/ref';
import { lstatIfPresent } from '../../host/absence';
import type { Context } from '../../host/context';
import { replaceDirectoryAfterBuild } from '../../host/directory-replacement';
import { reconcileManagedLinks } from '../../host/managed-links';
import { type HostPath, resolveHostPath, symbolic } from '../../host/path';
import { isSymlinkTo, placeSymlink } from '../../host/symlink';
import type { Activation, ActivationReport, Described } from './contract';
import { guarded } from './reconcile';

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

async function ensureTreeRoot(root: string): Promise<boolean> {
  const stats = await lstatIfPresent(root);
  if (!stats) {
    await mkdir(root, { recursive: true });
    return true;
  }
  if (stats.isDirectory() && !stats.isSymbolicLink()) {
    return false;
  }
  return replaceDirectoryAfterBuild(root, async () => {});
}

export async function runFile(
  activation: FileActivation,
  context: Context,
): Promise<ActivationReport> {
  const base = describeFile(activation);
  return guarded(base, async () => {
    const link = resolveHostPath(activation.dest, context.home);
    const target = deployedPath(activation.source, context.home);
    if (await isSymlinkTo(link, target)) {
      return { ...base, status: 'unchanged' };
    }
    await placeSymlink(link, target);
    return { ...base, status: 'changed' };
  });
}

export async function runTree(
  activation: TreeActivation,
  context: Context,
): Promise<ActivationReport> {
  const base = describeTree(activation);
  return guarded(base, async () => {
    const refs = context.assets
      .keysByPrefix(activation.prefix)
      .map((key) => asset(key));
    const root = resolveHostPath(activation.dest, context.home);
    const managedRoots = [deployedDir(activation.prefix, context.home)];
    const entries = treeEntries(refs, activation.prefix, root, context.home);

    const rootChanged = await ensureTreeRoot(root);
    const linksChanged = await reconcileManagedLinks(
      root,
      managedRoots,
      entries.map((entry) => ({ path: entry.link, target: entry.target })),
    );

    return {
      ...base,
      status: rootChanged || linksChanged ? 'changed' : 'unchanged',
    };
  });
}
