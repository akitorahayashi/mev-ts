import { lstat, mkdir, readdir, readlink, rm, symlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  type AssetRef,
  asset,
  deployedDir,
  deployedDirSymbolic,
  deployedPath,
  deployedSymbolic,
} from '../assets/ref';
import { ProvisioningError } from '../errors';
import type { Context } from '../host/context';
import { resolveHostPath, symbolic } from '../host/path';
import type { Activation, Verb } from './target';

export type ActivationStatus = 'changed' | 'unchanged' | 'failed' | 'blocked';

export interface ActivationReport {
  readonly verb: Verb;
  readonly source: string;
  readonly dest: string;
  readonly status: ActivationStatus;
  readonly error?: string;
}

/** Stable, home-independent description of an activation's verb and endpoints. */
export function describeActivation(activation: Activation): {
  verb: Verb;
  source: string;
  dest: string;
} {
  if (activation.kind === 'file') {
    return {
      verb: activation.verb,
      source: deployedSymbolic(activation.source),
      dest: symbolic(activation.dest),
    };
  }
  return {
    verb: activation.verb,
    source: deployedDirSymbolic(activation.prefix),
    dest: symbolic(activation.dest),
  };
}

/** Report for an activation whose role deploy failed and so cannot proceed. */
export function blockedReport(activation: Activation): ActivationReport {
  return { ...describeActivation(activation), status: 'blocked' };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function lstatOrNull(path: string) {
  try {
    return await lstat(path);
  } catch {
    return null;
  }
}

async function isSymlinkTo(link: string, target: string): Promise<boolean> {
  const stats = await lstatOrNull(link);
  if (!stats?.isSymbolicLink()) {
    return false;
  }
  return (await readlink(link)) === target;
}

/**
 * Replace `link` with a symlink to `target`. A pre-existing symlink is
 * replaced; a pre-existing regular file or directory is preserved unless
 * `overwrite` is set, so unmanaged user files are never silently destroyed.
 */
async function placeSymlink(
  link: string,
  target: string,
  overwrite: boolean,
): Promise<void> {
  const stats = await lstatOrNull(link);
  if (stats && !stats.isSymbolicLink() && !overwrite) {
    throw new ProvisioningError(
      `Refusing to replace unmanaged file at ${link}; re-run with --overwrite to replace it.`,
    );
  }
  await mkdir(dirname(link), { recursive: true });
  await rm(link, { force: true, recursive: true });
  await symlink(target, link);
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
  let names: string[];
  try {
    names = await readdir(root, { recursive: true });
  } catch {
    return [];
  }
  const base = managedRoot.endsWith('/') ? managedRoot : `${managedRoot}/`;
  const stale: string[] = [];
  for (const name of names) {
    const path = join(root, name);
    if (expected.has(path)) {
      continue;
    }
    const stats = await lstatOrNull(path);
    if (!stats?.isSymbolicLink()) {
      continue;
    }
    const target = await readlink(path).catch(() => '');
    if (target.startsWith(base)) {
      stale.push(path);
    }
  }
  return stale;
}

async function runFile(
  activation: Extract<Activation, { kind: 'file' }>,
  context: Context,
  plan: boolean,
): Promise<ActivationReport> {
  const base = describeActivation(activation);
  try {
    const link = resolveHostPath(activation.dest, context.home);
    const target = deployedPath(activation.source, context.home);
    if (await isSymlinkTo(link, target)) {
      return { ...base, status: 'unchanged' };
    }
    if (plan) {
      return { ...base, status: 'changed' };
    }
    await placeSymlink(link, target, context.overwrite);
    return { ...base, status: 'changed' };
  } catch (error) {
    return { ...base, status: 'failed', error: errorMessage(error) };
  }
}

async function runTree(
  activation: Extract<Activation, { kind: 'tree' }>,
  context: Context,
  plan: boolean,
): Promise<ActivationReport> {
  const base = describeActivation(activation);
  try {
    const refs = context.assets
      .keysByPrefix(activation.prefix)
      .map((key) => asset(key));
    const root = resolveHostPath(activation.dest, context.home);
    const managedRoot = deployedDir(activation.prefix, context.home);
    const entries = treeEntries(refs, activation.prefix, root, context.home);

    let present = 0;
    for (const { link, target } of entries) {
      if (await isSymlinkTo(link, target)) {
        present += 1;
      }
    }
    const expected = new Set(entries.map((entry) => entry.link));
    const stale = await staleLinks(root, managedRoot, expected);

    if (present === entries.length && stale.length === 0) {
      return { ...base, status: 'unchanged' };
    }
    if (plan) {
      return { ...base, status: 'changed' };
    }

    for (const { link, target } of entries) {
      await mkdir(dirname(link), { recursive: true });
      await rm(link, { force: true, recursive: true });
      await symlink(target, link);
    }
    for (const link of await staleLinks(root, managedRoot, expected)) {
      await rm(link, { force: true });
    }
    return { ...base, status: 'changed' };
  } catch (error) {
    return { ...base, status: 'failed', error: errorMessage(error) };
  }
}

/**
 * Inspect an activation and, unless `plan` is set, apply it. Returns a report
 * whose status drives both the exit code and the per-tag execution log.
 */
export function runActivation(
  activation: Activation,
  context: Context,
  plan: boolean,
): Promise<ActivationReport> {
  return activation.kind === 'file'
    ? runFile(activation, context, plan)
    : runTree(activation, context, plan);
}
