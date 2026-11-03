import { stat } from 'node:fs/promises';
import { basename, isAbsolute, join } from 'node:path';
import { brewPrefix } from '../brew/prefix';
import { ProvisioningError } from '../errors';
import { lstatIfPresent } from '../host/absence';
import { formatCommandFailure } from '../host/command';
import type { Context } from '../host/context';
import {
  parseJsonLabeled,
  requireNonEmptyString,
  requireRecord,
  requireStringArray,
  requireUniqueBy,
} from '../host/parse';
import { requireRepoId } from './manifest';

interface Snapshot {
  readonly commit: string;
  readonly path: string;
}

export interface CachedModel {
  readonly main?: Snapshot;
}

export interface ModelResult {
  readonly status: 'changed' | 'unchanged';
  readonly value: string;
}

export type ModelAction =
  | 'check'
  | 'resolve'
  | 'download'
  | 'remove'
  | 'verify';

function requireCommit(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{40}$/.test(value)) {
    throw new ProvisioningError(`${label} must be a full commit SHA.`);
  }
  return value;
}

function requireSnapshot(
  value: unknown,
  commit: string,
  label: string,
): string {
  const path = requireNonEmptyString(value, label);
  if (!isAbsolute(path) || basename(path) !== commit) {
    throw new ProvisioningError(`${label} must identify snapshot ${commit}.`);
  }
  return path;
}

async function execute(
  context: Context,
  args: readonly string[],
  parseOutput = true,
): Promise<unknown> {
  const executable = join(await brewPrefix(context), 'bin', 'hf');
  const result = await context.commands.run(
    executable,
    [...args, '--format', 'json'],
    {
      cwd: context.home,
      env: {
        HOME: context.home,
        HF_HUB_DISABLE_PROGRESS_BARS: '1',
        LC_ALL: 'C',
      },
    },
  );
  if (result.code !== 0) {
    const missingCache =
      result.code === 1 && args[0] === 'cache' && args[1] === 'ls'
        ? /^(?:Error: )?Cache directory not found: (.+)$/m.exec(
            result.stderr,
          )?.[1]
        : undefined;
    if (
      missingCache &&
      isAbsolute(missingCache) &&
      (await lstatIfPresent(missingCache)) === null
    ) {
      return [];
    }
    throw new ProvisioningError(
      formatCommandFailure(`hf ${args.join(' ')} failed`, result),
    );
  }
  return parseOutput
    ? parseJsonLabeled(result.stdout, `hf ${args.join(' ')} output`)
    : undefined;
}

export async function listCached(
  context: Context,
): Promise<Map<string, CachedModel>> {
  const label = 'hf cache ls --revisions output';
  const data = await execute(context, ['cache', 'ls', '--revisions']);
  if (!Array.isArray(data)) {
    throw new ProvisioningError(`${label} must be a sequence.`);
  }
  const models = new Map<string, CachedModel>();
  for (const value of data) {
    const row = requireRecord(value, label);
    const type = requireNonEmptyString(row['repo_type'], `${label} repo_type`);
    if (type !== 'model') continue;
    const repo = requireRepoId(
      requireNonEmptyString(row['repo_id'], `${label} repo_id`),
      `${label} repo_id`,
    );
    const commit = requireCommit(row['revision'], `${label} revision`);
    const path = requireSnapshot(
      row['snapshot_path'],
      commit,
      `${label} snapshot_path`,
    );
    const refs = requireStringArray(row['refs'], `${label} refs`);
    const model = models.get(repo) ?? {};
    if (refs.includes('main')) {
      if (model.main) {
        throw new ProvisioningError(
          `${label} contains multiple main revisions for ${repo}.`,
        );
      }
      models.set(repo, { main: { commit, path } });
    } else {
      models.set(repo, model);
    }
  }
  return models;
}

async function resolveMain(repo: string, context: Context): Promise<string> {
  const label = `hf models info ${repo} output`;
  const data = requireRecord(
    await execute(context, [
      'models',
      'info',
      repo,
      '--revision',
      'main',
      '--expand',
      'sha',
    ]),
    label,
  );
  return requireCommit(data['sha'], `${label} sha`);
}

async function expectedFiles(
  repo: string,
  commit: string,
  context: Context,
): Promise<string[]> {
  const label = `hf download ${repo} --dry-run output`;
  const data = await execute(context, [
    'download',
    repo,
    '--revision',
    commit,
    '--dry-run',
  ]);
  if (!Array.isArray(data) || data.length === 0) {
    throw new ProvisioningError(`${label} must contain the model's files.`);
  }
  const files = data.map((value) => {
    const row = requireRecord(value, label);
    const file = requireNonEmptyString(row['file'], `${label} file`);
    if (
      isAbsolute(file) ||
      file.includes('\0') ||
      file
        .split('/')
        .some(
          (segment) => segment === '' || segment === '.' || segment === '..',
        )
    ) {
      throw new ProvisioningError(
        `${label} contains an unsafe file path '${file}'.`,
      );
    }
    return file;
  });
  requireUniqueBy(files, (file) => file, label);
  return files;
}

async function complete(
  path: string,
  files: readonly string[],
): Promise<boolean> {
  const present = await Promise.all(
    files.map(async (file) => {
      try {
        return (await stat(join(path, file))).isFile();
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
        throw error;
      }
    }),
  );
  return present.every(Boolean);
}

export async function ensureModel(
  repo: string,
  previous: CachedModel | undefined,
  context: Context,
  upgrade: boolean,
  onAction: (action: ModelAction) => void,
): Promise<ModelResult> {
  onAction(upgrade || !previous?.main ? 'resolve' : 'check');
  const commit =
    previous?.main && !upgrade
      ? previous.main.commit
      : await resolveMain(repo, context);
  const files = await expectedFiles(repo, commit, context);
  const current = previous?.main?.commit === commit;
  if (current && previous.main && (await complete(previous.main.path, files))) {
    return { status: 'unchanged', value: `up to date (${commit})` };
  }

  onAction('download');
  const label = `hf download ${repo} output`;
  const result = requireRecord(
    await execute(context, [
      'download',
      repo,
      '--revision',
      current ? commit : 'main',
    ]),
    label,
  );
  // A moving main or the CLI's offline cache fallback must not masquerade as
  // successful reconciliation of the commit resolved above.
  const path = requireSnapshot(
    result['path'],
    commit,
    `${label} path; retry if main moved`,
  );
  onAction('verify');
  if (!(await complete(path, files))) {
    throw new ProvisioningError(
      `Hugging Face model ${repo} is incomplete after download; retry with network access.`,
    );
  }
  return {
    status: 'changed',
    value: `${current ? 'repaired' : previous?.main ? 'updated to' : 'installed'} ${commit}`,
  };
}

export async function removeModel(
  repo: string,
  previous: CachedModel | undefined,
  context: Context,
): Promise<ModelResult> {
  if (!previous) return { status: 'unchanged', value: 'already absent' };
  await execute(context, ['cache', 'rm', `model/${repo}`, '--yes'], false);
  if ((await listCached(context)).has(repo)) {
    throw new ProvisioningError(
      `Hugging Face model ${repo} remains cached after removal.`,
    );
  }
  return { status: 'changed', value: 'uninstalled all revisions' };
}
