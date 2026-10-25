import { createHash, randomUUID } from 'node:crypto';
import {
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  rmdir,
  unlink,
} from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { errorMessage, ProvisioningError } from '../errors';
import { lstatIfPresent, readDirentsIfPresent } from './absence';
import { runWithCleanup } from './cleanup-error';
import {
  type EntryIdentity,
  type EntrySnapshot,
  entryIdentity,
  isEntryIdentity,
  isEntrySnapshot,
  matchesSnapshot,
  sameIdentity,
  snapshotEntry,
} from './entry-snapshot';
import { mevPath, resolveHostPath } from './path';

type PublicationState =
  | 'prepared'
  | 'published'
  | 'cleanup-old'
  | 'cleanup-new';

export interface TransactionRecord {
  readonly version: 1;
  readonly id: string;
  readonly home: string;
  readonly directory: string;
  readonly identity: EntryIdentity;
  readonly dest: string;
  readonly staged: string;
  readonly backup: string;
  readonly previous: EntrySnapshot | null;
  readonly replacement: EntrySnapshot;
  readonly strategy: 'atomic' | 'backup';
  readonly state: PublicationState;
}

export function transactionRecordsRoot(home: string): string {
  return resolveHostPath(mevPath('transactions'), home);
}

function ownerMarker(record: TransactionRecord): string {
  const { state: _state, ...immutable } = record;
  return `${record.id}\n${createHash('sha256').update(JSON.stringify(immutable)).digest('hex')}\n`;
}

function retained(path: string, reason: string): ProvisioningError {
  return new ProvisioningError(
    `Transaction recovery refused at ${path}: ${reason}. All remaining state is retained for inspection.`,
  );
}

async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, 'r');
  await runWithCleanup(
    () => handle.sync(),
    () => handle.close(),
    `Failed to close transaction directory ${path}.`,
  );
}

async function writeRecord(
  path: string,
  record: TransactionRecord,
): Promise<void> {
  const pending = `${path}.pending`;
  const handle = await open(pending, 'wx', 0o600);
  await runWithCleanup(
    async () => {
      await handle.writeFile(`${JSON.stringify(record)}\n`);
      await handle.sync();
    },
    () => handle.close(),
    `Failed to close transaction record ${pending}.`,
  );
  await rename(pending, path);
  await syncDirectory(dirname(path));
}

function validPath(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    isAbsolute(value) &&
    resolve(value) === value &&
    !value.includes('\0')
  );
}

async function loadRecord(
  path: string,
  home: string,
): Promise<TransactionRecord> {
  const stats = await lstat(path);
  if (!stats.isFile() || stats.isSymbolicLink())
    throw retained(path, 'record is not a regular file');
  const value: unknown = JSON.parse(await readFile(path, 'utf8'));
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw retained(path, 'invalid record');
  const raw = value as Record<string, unknown>;
  if (
    Object.keys(raw).sort().join(',') !==
      'backup,dest,directory,home,id,identity,previous,replacement,staged,state,strategy,version' ||
    raw['version'] !== 1 ||
    typeof raw['id'] !== 'string' ||
    !/^[0-9a-f-]{36}$/.test(raw['id']) ||
    raw['home'] !== home ||
    !validPath(raw['directory']) ||
    !validPath(raw['dest']) ||
    raw['staged'] !== join(raw['directory'], 'staged') ||
    raw['backup'] !== join(raw['directory'], 'backup') ||
    dirname(raw['dest']) !== dirname(raw['directory']) ||
    !basename(raw['directory']).startsWith(`.${basename(raw['dest'])}.`) ||
    !isEntryIdentity(raw['identity']) ||
    (raw['previous'] !== null && !isEntrySnapshot(raw['previous'])) ||
    !isEntrySnapshot(raw['replacement']) ||
    typeof raw['state'] !== 'string' ||
    !['prepared', 'published', 'cleanup-old', 'cleanup-new'].includes(
      raw['state'],
    ) ||
    typeof raw['strategy'] !== 'string' ||
    !['atomic', 'backup'].includes(raw['strategy'])
  ) {
    throw retained(path, 'unknown record schema or ownership');
  }
  const record = raw as unknown as TransactionRecord;
  if (
    basename(path).replace(/\.pending$/, '') !== `${record.id}.json` ||
    (record.strategy === 'backup' && record.previous === null)
  )
    throw retained(path, 'inconsistent record identity');
  return record;
}

async function validateEnvelope(
  record: TransactionRecord,
  cleanup: boolean,
): Promise<void> {
  const stats = await lstatIfPresent(record.directory);
  if (!stats) {
    if (cleanup) return;
    throw retained(record.directory, 'transaction directory is absent');
  }
  if (
    !stats.isDirectory() ||
    stats.isSymbolicLink() ||
    !sameIdentity(await entryIdentity(record.directory), record.identity)
  )
    throw retained(record.directory, 'transaction directory identity changed');
  const names = await readdir(record.directory);
  if (names.some((name) => !['staged', 'backup', 'owner'].includes(name)))
    throw retained(record.directory, 'unexpected transaction contents');
  const marker = join(record.directory, 'owner');
  const markerStats = await lstatIfPresent(marker);
  if (!markerStats) {
    if (cleanup && names.length === 0) return;
    throw retained(record.directory, 'ownership marker is absent');
  }
  if (
    !markerStats.isFile() ||
    markerStats.isSymbolicLink() ||
    (await readFile(marker, 'utf8')) !== ownerMarker(record)
  )
    throw retained(record.directory, 'ownership marker changed');
}

export async function prepareTransactionRecord(
  home: string,
  directory: string,
  dest: string,
  staged: string,
  backup: string,
): Promise<TransactionRecord> {
  const identity = await entryIdentity(directory);
  const previous = await snapshotEntry(dest);
  const replacement = await snapshotEntry(staged);
  if (!identity || !replacement)
    throw retained(directory, 'staged replacement is absent');
  const record: TransactionRecord = {
    version: 1,
    id: randomUUID(),
    home: await realpath(home),
    directory,
    identity,
    dest,
    staged,
    backup,
    previous,
    replacement,
    strategy:
      previous &&
      (previous.kind === 'directory' || replacement.kind === 'directory')
        ? 'backup'
        : 'atomic',
    state: 'prepared',
  };
  const root = transactionRecordsRoot(record.home);
  await mkdir(root, { recursive: true, mode: 0o700 });
  const marker = await open(join(directory, 'owner'), 'wx', 0o600);
  await runWithCleanup(
    async () => {
      await marker.writeFile(ownerMarker(record));
      await marker.sync();
    },
    () => marker.close(),
    `Failed to close transaction owner at ${directory}.`,
  );
  await syncDirectory(directory);
  await writeRecord(join(root, `${record.id}.json`), record);
  return record;
}

export async function publishTransaction(
  record: TransactionRecord,
): Promise<TransactionRecord> {
  await syncDirectory(dirname(record.dest));
  await syncDirectory(record.directory);
  const published: TransactionRecord = { ...record, state: 'published' };
  await writeRecord(
    join(transactionRecordsRoot(record.home), `${record.id}.json`),
    published,
  );
  return published;
}

async function latestRecord(
  file: string,
  home: string,
): Promise<TransactionRecord> {
  const pendingPath = `${file}.pending`;
  if (await lstatIfPresent(pendingPath)) {
    const pending = await loadRecord(pendingPath, home);
    const current = (await lstatIfPresent(file))
      ? await loadRecord(file, home)
      : null;
    if (
      current &&
      (JSON.stringify({ ...pending, state: current.state }) !==
        JSON.stringify(current) ||
        !(
          current.state === pending.state ||
          (current.state === 'prepared' &&
            ['published', 'cleanup-old', 'cleanup-new'].includes(
              pending.state,
            )) ||
          (current.state === 'published' && pending.state === 'cleanup-new')
        ))
    ) {
      throw retained(
        file,
        'pending journal update does not match its owner and prior publication state',
      );
    }
    if (!current && pending.state !== 'prepared')
      throw retained(file, 'pending record has no prepared predecessor');
    await validateEnvelope(pending, pending.state.startsWith('cleanup-'));
    await rename(pendingPath, file);
    await syncDirectory(dirname(file));
  }
  return loadRecord(file, home);
}

export async function finishTransaction(
  record: TransactionRecord,
): Promise<void> {
  const file = join(transactionRecordsRoot(record.home), `${record.id}.json`);
  await recoverTransaction(await latestRecord(file, record.home));
}

export async function recoverTransaction(
  record: TransactionRecord,
): Promise<void> {
  const file = join(transactionRecordsRoot(record.home), `${record.id}.json`);
  const cleanup =
    record.state === 'cleanup-old' || record.state === 'cleanup-new';
  await validateEnvelope(record, cleanup);
  const [dest, staged, backup] = await Promise.all([
    snapshotEntry(record.dest),
    snapshotEntry(record.staged),
    snapshotEntry(record.backup),
  ]);
  let keep: 'old' | 'new';
  if (record.state === 'cleanup-old') {
    if (
      !matchesSnapshot(dest, record.previous) ||
      backup !== null ||
      !matchesSnapshot(staged, record.replacement, true)
    )
      throw retained(file, 'old-state cleanup contains external changes');
    keep = 'old';
  } else if (record.state === 'cleanup-new') {
    if (
      !matchesSnapshot(dest, record.replacement) ||
      staged !== null ||
      (record.strategy === 'atomic'
        ? backup !== null
        : !matchesSnapshot(backup, record.previous, true))
    )
      throw retained(file, 'new-state cleanup contains external changes');
    keep = 'new';
  } else if (
    matchesSnapshot(dest, record.replacement) &&
    staged === null &&
    (record.strategy === 'atomic'
      ? backup === null
      : matchesSnapshot(backup, record.previous) ||
        (record.state === 'published' && backup === null))
  ) {
    keep = 'new';
  } else if (
    record.state === 'prepared' &&
    matchesSnapshot(staged, record.replacement) &&
    ((matchesSnapshot(dest, record.previous) && backup === null) ||
      (record.strategy === 'backup' &&
        dest === null &&
        matchesSnapshot(backup, record.previous)))
  ) {
    keep = 'old';
    if (dest === null && backup !== null) {
      await rename(record.backup, record.dest);
      await syncDirectory(dirname(record.dest));
    }
  } else
    throw retained(
      file,
      'publication cannot be established from recorded filesystem identities',
    );
  if (!cleanup) {
    record = {
      ...record,
      state: keep === 'old' ? 'cleanup-old' : 'cleanup-new',
    };
    await writeRecord(file, record);
  }
  const remove = keep === 'old' ? record.staged : record.backup;
  if (await lstatIfPresent(remove)) await rm(remove, { recursive: true });
  const marker = join(record.directory, 'owner');
  if (await lstatIfPresent(marker)) await unlink(marker);
  if (await lstatIfPresent(record.directory)) await rmdir(record.directory);
  await syncDirectory(dirname(record.directory));
  await unlink(file);
  await syncDirectory(dirname(file));
}

export async function recoverTransactions(home: string): Promise<void> {
  const root = transactionRecordsRoot(home);
  const entries = await readDirentsIfPresent(root);
  if (!entries) return;
  const ownerHome = await realpath(home);
  const records = new Set<string>();
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(root, entry.name);
    try {
      if (
        !entry.isFile() ||
        !/^[0-9a-f-]{36}\.json(?:\.pending)?$/.test(entry.name)
      )
        throw retained(path, 'unrecognized or incomplete recovery record');
      records.add(path.replace(/\.pending$/, ''));
    } catch (error) {
      if (error instanceof ProvisioningError) throw error;
      throw retained(path, errorMessage(error));
    }
  }
  for (const file of records) {
    try {
      await recoverTransaction(await latestRecord(file, ownerHome));
    } catch (error) {
      if (error instanceof ProvisioningError) throw error;
      throw retained(file, errorMessage(error));
    }
  }
}
