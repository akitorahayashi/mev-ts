import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  type AssetRef,
  asset,
  deployedDir,
  deployedPath,
} from '../../assets/ref';
import { lstatIfPresent } from '../../host/absence';
import type { Context } from '../../host/context';
import { replaceDirectoryAfterBuild } from '../../host/directory-replacement';
import { reconcileManagedLinks } from '../../host/managed-links';
import { type HostPath, resolveHostPath, symbolic } from '../../host/path';
import { isSymlinkTo, placeSymlink } from '../../host/symlink';
import type {
  Activation,
  ActivationDescription,
  ActivationReport,
  ActivationRunOptions,
} from './contract';
import { activationReport, guarded } from './reconcile';

type FileActivation = Extract<Activation, { kind: 'file' }>;
type TreeActivation = Extract<Activation, { kind: 'tree' }>;

export function link(source: AssetRef, dest: HostPath): Activation {
  return { kind: 'file', source, dest };
}

export function linkTree(prefix: string, dest: HostPath): Activation {
  return { kind: 'tree', prefix, dest };
}

export function describeFile(
  activation: FileActivation,
): ActivationDescription {
  return {
    subject: symbolic(activation.dest),
  };
}

export function describeTree(
  activation: TreeActivation,
): ActivationDescription {
  return {
    subject: symbolic(activation.dest),
    unchangedCollection: 'managed links',
  };
}

interface TreeEntry {
  readonly key: string;
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
    key: ref.key,
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
  if (stats.isDirectory()) {
    return false;
  }
  return replaceDirectoryAfterBuild(root, async () => {});
}

export async function runFile(
  activation: FileActivation,
  context: Context,
  options: ActivationRunOptions = { upgrade: false },
): Promise<ActivationReport> {
  const base = describeFile(activation);
  return guarded(base, async () => {
    const link = resolveHostPath(activation.dest, context.home);
    const target = deployedPath(activation.source, context.home);
    const linkCurrent = await isSymlinkTo(link, target);
    if (!linkCurrent) {
      await placeSymlink(link, target);
    }
    const contentChanged = options.sourceChanges?.some(
      (change) => change.key === activation.source.key,
    );
    const details = [
      ...(!linkCurrent ? ['linked to managed config'] : []),
      ...(contentChanged ? ['managed content updated'] : []),
    ];
    return activationReport(base, [
      {
        label: base.subject,
        status: details.length > 0 ? 'changed' : 'unchanged',
        details:
          details.length > 0
            ? details
            : ['already linked to current managed config'],
      },
    ]);
  });
}

export async function runTree(
  activation: TreeActivation,
  context: Context,
  options: ActivationRunOptions = { upgrade: false },
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
    const links = await reconcileManagedLinks(
      root,
      managedRoots,
      entries.map((entry) => ({ path: entry.link, target: entry.target })),
    );

    const changedKeys = new Set(
      options.sourceChanges
        ?.filter((change) => change.key.startsWith(activation.prefix))
        .map((change) => change.key) ?? [],
    );
    const placed = new Set(links.placed.map((entry) => entry.path));
    const outcomes = entries.map((entry) => {
      const changed = placed.has(entry.link) || changedKeys.has(entry.key);
      return {
        label: entry.link.startsWith(`${context.home}/`)
          ? `~/${entry.link.slice(context.home.length + 1)}`
          : entry.link,
        status: changed ? ('changed' as const) : ('unchanged' as const),
        details: changed
          ? [
              ...(placed.has(entry.link) ? ['linked to managed config'] : []),
              ...(changedKeys.has(entry.key)
                ? ['managed content updated']
                : []),
            ]
          : ['already linked to current managed config'],
      };
    });
    for (const removed of links.removed) {
      outcomes.push({
        label: removed.startsWith(`${context.home}/`)
          ? `~/${removed.slice(context.home.length + 1)}`
          : removed,
        status: 'changed',
        details: ['removed obsolete managed link'],
      });
    }
    if (rootChanged && outcomes.length === 0) {
      outcomes.push({
        label: base.subject,
        status: 'changed',
        details: ['created managed directory'],
      });
    }
    return activationReport(base, outcomes);
  });
}
