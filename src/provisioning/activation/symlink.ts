import { mkdir, rm } from 'node:fs/promises';
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
import { replaceDirectoryAfterBuild } from '../../host/directory-replacement';
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

function legacyKey(key: string): string | null {
  const slash = key.indexOf('/');
  if (slash === -1 || slash === key.length - 1) {
    return null;
  }
  return `${key.slice(0, slash)}/global/${key.slice(slash + 1)}`;
}

async function staleLinks(
  root: string,
  managedRoots: readonly string[],
  expected: ReadonlySet<string>,
): Promise<string[]> {
  const names = await readDirectoryIfPresent(root);
  if (names === null) {
    return [];
  }
  const bases = managedRoots.map((managedRoot) =>
    managedRoot.endsWith('/') ? managedRoot : `${managedRoot}/`,
  );
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
    if (target && bases.some((base) => target.startsWith(base))) {
      stale.push(path);
    }
  }
  return stale;
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
    const legacyPrefix = legacyKey(activation.prefix);
    const managedRoots = [
      deployedDir(activation.prefix, context.home),
      ...(legacyPrefix === null
        ? []
        : [deployedDir(legacyPrefix, context.home)]),
    ];
    const entries = treeEntries(refs, activation.prefix, root, context.home);

    const rootChanged = await ensureTreeRoot(root);

    const drifted: TreeEntry[] = [];
    for (const { link, target } of entries) {
      if (await isSymlinkTo(link, target)) {
        continue;
      }
      drifted.push({ link, target });
    }
    const expected = new Set(entries.map((entry) => entry.link));
    const stale = await staleLinks(root, managedRoots, expected);

    if (!rootChanged && drifted.length === 0 && stale.length === 0) {
      return { ...base, status: 'unchanged' };
    }

    for (const { link, target } of drifted) {
      await placeSymlink(link, target);
    }
    for (const link of stale) {
      await rm(link, { force: true });
    }
    return { ...base, status: 'changed' };
  });
}

export async function migrateLegacySymlinks(
  activations: readonly Activation[],
  context: Context,
): Promise<void> {
  for (const activation of activations) {
    if (activation.kind === 'file') {
      const legacy = legacyKey(activation.source.key);
      if (legacy === null) {
        continue;
      }
      const link = resolveHostPath(activation.dest, context.home);
      const target = deployedPath(activation.source, context.home);
      const legacyTarget = deployedPath({ key: legacy }, context.home);
      if (await isSymlinkTo(link, legacyTarget)) {
        await placeSymlink(link, target);
      }
      continue;
    }

    if (activation.kind !== 'tree') {
      continue;
    }
    const legacyPrefix = legacyKey(activation.prefix);
    if (legacyPrefix === null) {
      continue;
    }
    const refs = context.assets
      .keysByPrefix(activation.prefix)
      .map((key) => asset(key));
    const root = resolveHostPath(activation.dest, context.home);
    for (const { link, target } of treeEntries(
      refs,
      activation.prefix,
      root,
      context.home,
    )) {
      const relative = link.slice(root.length + 1);
      const legacyTarget = deployedPath(
        { key: `${legacyPrefix}${relative}` },
        context.home,
      );
      if (await isSymlinkTo(link, legacyTarget)) {
        await placeSymlink(link, target);
      }
    }
  }
}
