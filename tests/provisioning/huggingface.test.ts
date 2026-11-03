import { expect } from 'bun:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { deployedDir } from '../../src/assets/ref';
import type { CommandResult } from '../../src/host/command';
import {
  type ActivationActivity,
  applyHuggingfaceModels,
  runActivation,
} from '../../src/provisioning/activation';
import { outcomeStatus } from '../../src/provisioning/resource-outcome';
import { fail, ok } from '../fixtures/fake-command-runner';
import { type Responder, recordingContext } from '../fixtures/fake-context';
import { sandboxedTest } from '../fixtures/temporary-directory';

const sandboxTest = sandboxedTest('huggingface-');
const REPO = 'publisher/vision';
const COMMIT = 'a'.repeat(40);
const NEW_COMMIT = 'b'.repeat(40);
const HF = '/opt/homebrew/bin/hf';
const activation = applyHuggingfaceModels('hf/models.yml');
const FILES = ['config.json', 'weights/model.safetensors'];

function snapshot(dir: string, commit = COMMIT): string {
  return join(dir, 'hub', 'snapshots', commit);
}

async function populate(path: string, files = FILES): Promise<void> {
  for (const file of files) {
    const dest = join(path, file);
    await mkdir(join(dest, '..'), { recursive: true });
    await writeFile(dest, 'fixture');
  }
}

function cached(dir: string, commit = COMMIT, repo = REPO, refs = ['main']) {
  return {
    repo_type: 'model',
    repo_id: repo,
    revision: commit,
    snapshot_path: snapshot(dir, commit),
    refs,
  };
}

async function setup(dir: string, raw: string, respond: Responder) {
  const role = deployedDir('hf', dir);
  await mkdir(role, { recursive: true });
  await writeFile(join(role, 'models.yml'), raw);
  return recordingContext({
    home: dir,
    basePath: '/legacy/bin',
    respond: (command, args, options) => {
      if (command === 'brew' && args.join(' ') === '--prefix') {
        return ok('/opt/homebrew');
      }
      if (command !== HF) throw new Error(`Unexpected command ${command}`);
      return respond(command, args, options);
    },
  });
}

function responder(
  dir: string,
  inventory: unknown[],
  remote = COMMIT,
  override?: Responder,
): Responder {
  return async (command, args, options): Promise<CommandResult> => {
    if (override) return override(command, args, options);
    if (args[0] === 'cache' && args[1] === 'ls')
      return ok(JSON.stringify(inventory));
    if (args[0] === 'models' && args[1] === 'info')
      return ok(JSON.stringify({ sha: remote }));
    if (args[0] === 'download' && args.includes('--dry-run')) {
      return ok(JSON.stringify(FILES.map((file) => ({ file, size: '-' }))));
    }
    if (args[0] === 'download') {
      await populate(snapshot(dir, remote));
      return ok(JSON.stringify({ path: snapshot(dir, remote) }));
    }
    throw new Error(`Unexpected hf operation ${args.join(' ')}`);
  };
}

sandboxTest(
  'a missing cache does not prevent first installation',
  async (dir) => {
    const absentCache = join(dir, 'cache not created');
    const base = responder(dir, []);
    const { context } = await setup(
      dir,
      `models: [${REPO}]`,
      (command, args, options) =>
        args[0] === 'cache' && args[1] === 'ls'
          ? fail(
              `Error: Cache directory not found: ${absentCache}\nHint: set HF_DEBUG=1 as environment variable for full traceback.\n`,
            )
          : base(command, args, options),
    );
    const report = await runActivation(activation, context);
    expect(report.outcomes).toEqual([
      { label: REPO, status: 'changed', details: [`installed ${COMMIT}`] },
    ]);
  },
);

sandboxTest(
  'a missing-cache diagnostic cannot hide a failure for an existing path',
  async (dir) => {
    const existingCache = join(dir, 'cache');
    await mkdir(existingCache);
    const { context, calls } = await setup(dir, `models: [${REPO}]`, () =>
      fail(`Error: Cache directory not found: ${existingCache}\n`),
    );
    const report = await runActivation(activation, context);
    expect(report.outcomes[0]).toMatchObject({
      status: 'failed',
      error: expect.stringContaining('Cache directory not found'),
    });
    expect(calls.filter((call) => call.command === HF)).toHaveLength(1);
  },
);

for (const diagnostic of [
  'Permission denied',
  'Corrupt cache',
  'Unknown option: --format',
]) {
  sandboxTest(`cache errors retain diagnostics: ${diagnostic}`, async (dir) => {
    const { context, calls } = await setup(dir, `models: [${REPO}]`, () =>
      fail(diagnostic),
    );
    const report = await runActivation(activation, context);
    expect(report.outcomes[0]).toMatchObject({
      status: 'failed',
      error: expect.stringContaining(diagnostic),
    });
    expect(calls.filter((call) => call.command === HF)).toHaveLength(1);
  });
}

sandboxTest(
  'fresh models are downloaded completely with the Homebrew CLI',
  async (dir) => {
    const { context, calls } = await setup(
      dir,
      `models: [${REPO}]`,
      responder(dir, []),
    );
    const activities: ActivationActivity[] = [];
    const report = await runActivation(activation, context, {
      upgrade: false,
      onActivity: (event) => activities.push(event),
    });
    expect(report.outcomes).toEqual([
      { label: REPO, status: 'changed', details: [`installed ${COMMIT}`] },
    ]);
    expect(
      calls.find(
        (call) =>
          call.args[0] === 'download' && !call.args.includes('--dry-run'),
      )?.args,
    ).toEqual(['download', REPO, '--revision', 'main', '--format', 'json']);
    for (const call of calls.filter((call) => call.command === HF)) {
      expect(call.options?.env?.['HOME']).toBe(dir);
      expect(call.args.slice(-2)).toEqual(['--format', 'json']);
    }
    const started = activities.filter(
      (event) => event.operation?.state === 'started',
    );
    const finished = activities.filter(
      (event) => event.operation?.state === 'finished',
    );
    expect(started.map((event) => event.action)).toEqual([
      'resolve',
      'download',
      'verify',
    ]);
    expect(finished.map((event) => event.operation?.id)).toEqual(
      started.map((event) => event.operation?.id),
    );
  },
);

sandboxTest(
  'ordinary applies preserve cached main and ignore unlisted models',
  async (dir) => {
    await populate(snapshot(dir));
    const { context, calls } = await setup(
      dir,
      `models: [${REPO}]`,
      responder(
        dir,
        [
          cached(dir),
          cached(dir, NEW_COMMIT, 'gpt2'),
          { repo_type: 'dataset', repo_id: 'publisher/data' },
        ],
        NEW_COMMIT,
      ),
    );
    const report = await runActivation(activation, context);
    expect(outcomeStatus(report.outcomes)).toBe('unchanged');
    expect(
      calls.filter((call) => call.command === HF).map((call) => call.args),
    ).toEqual([
      ['cache', 'ls', '--revisions', '--format', 'json'],
      ['download', REPO, '--revision', COMMIT, '--dry-run', '--format', 'json'],
    ]);
  },
);

sandboxTest(
  'a partial snapshot is repaired without changing its revision',
  async (dir) => {
    await populate(snapshot(dir), ['config.json']);
    const { context, calls } = await setup(
      dir,
      `models: [${REPO}]`,
      responder(dir, [cached(dir)]),
    );
    const report = await runActivation(activation, context);
    expect(report.outcomes[0]).toMatchObject({
      status: 'changed',
      details: [`repaired ${COMMIT}`],
    });
    expect(
      calls.find(
        (call) =>
          call.args[0] === 'download' && !call.args.includes('--dry-run'),
      )?.args,
    ).toContain(COMMIT);
  },
);

sandboxTest(
  'upgrade resolves main while normal cache checks remain pinned',
  async (dir) => {
    await populate(snapshot(dir));
    const { context, calls } = await setup(
      dir,
      `models: [${REPO}]`,
      responder(dir, [cached(dir)], NEW_COMMIT),
    );
    const report = await runActivation(activation, context, { upgrade: true });
    expect(report.outcomes[0]).toMatchObject({
      status: 'changed',
      details: [`updated to ${NEW_COMMIT}`],
    });
    expect(calls.some((call) => call.args[0] === 'models')).toBe(true);
    expect(
      calls.find((call) => call.args.includes('--dry-run'))?.args,
    ).toContain(NEW_COMMIT);
  },
);

sandboxTest(
  'upgrade reports unchanged when main still names a complete snapshot',
  async (dir) => {
    await populate(snapshot(dir));
    const { context, calls } = await setup(
      dir,
      `models: [${REPO}]`,
      responder(dir, [cached(dir)]),
    );
    const report = await runActivation(activation, context, { upgrade: true });
    expect(outcomeStatus(report.outcomes)).toBe('unchanged');
    expect(
      calls
        .filter((call) => call.args[0] === 'download')
        .every((call) => call.args.includes('--dry-run')),
    ).toBe(true);
  },
);

sandboxTest(
  'a cached non-main revision does not select a version for first install',
  async (dir) => {
    await populate(snapshot(dir));
    const { context } = await setup(
      dir,
      `models: [${REPO}]`,
      responder(dir, [cached(dir, COMMIT, REPO, ['other'])], NEW_COMMIT),
    );
    const report = await runActivation(activation, context);
    expect(report.outcomes[0]).toMatchObject({
      status: 'changed',
      details: [`installed ${NEW_COMMIT}`],
    });
  },
);

sandboxTest(
  'only explicit model removals delete all revisions and are repeatable',
  async (dir) => {
    let inventory = [
      cached(dir),
      cached(dir, NEW_COMMIT, REPO, ['other']),
      cached(dir, COMMIT, 'publisher/keep'),
    ];
    const { context, calls } = await setup(
      dir,
      `models: []\nuninstall: [${REPO}]`,
      async (_command, args) => {
        if (args[0] === 'cache' && args[1] === 'ls')
          return ok(JSON.stringify(inventory));
        if (args[0] === 'cache' && args[1] === 'rm') {
          inventory = inventory.filter((row) => row.repo_id !== REPO);
          return ok(JSON.stringify({ repos_deleted: 1, revisions_deleted: 2 }));
        }
        throw new Error(`Unexpected operation ${args.join(' ')}`);
      },
    );
    expect(
      outcomeStatus((await runActivation(activation, context)).outcomes),
    ).toBe('changed');
    expect(
      outcomeStatus((await runActivation(activation, context)).outcomes),
    ).toBe('unchanged');
    expect(
      calls.filter((call) => call.args[1] === 'rm').map((call) => call.args),
    ).toEqual([['cache', 'rm', `model/${REPO}`, '--yes', '--format', 'json']]);
    expect(inventory.map((row) => row.repo_id)).toEqual(['publisher/keep']);
  },
);

sandboxTest(
  'removal racing with another cache client can succeed with empty output',
  async (dir) => {
    let listed = false;
    const { context } = await setup(
      dir,
      `models: []\nuninstall: [${REPO}]`,
      (_command, args) => {
        if (args[1] === 'ls') {
          const result = ok(JSON.stringify(listed ? [] : [cached(dir)]));
          listed = true;
          return result;
        }
        if (args[1] === 'rm') return ok();
        throw new Error('Unexpected operation');
      },
    );
    expect(
      outcomeStatus((await runActivation(activation, context)).outcomes),
    ).toBe('changed');
  },
);

sandboxTest('a removal that leaves the model cached is failed', async (dir) => {
  const { context } = await setup(
    dir,
    `models: []\nuninstall: [${REPO}]`,
    (_command, args) =>
      args[1] === 'ls' ? ok(JSON.stringify([cached(dir)])) : ok('{}'),
  );
  const report = await runActivation(activation, context);
  expect(report.outcomes[0]).toMatchObject({
    status: 'failed',
    error: expect.stringContaining('remains cached'),
  });
});

sandboxTest(
  'a failed removal does not block another model install',
  async (dir) => {
    const base = responder(dir, [cached(dir, COMMIT, 'publisher/old')]);
    const { context } = await setup(
      dir,
      `models: [${REPO}]\nuninstall: [publisher/old]`,
      (command, args, options) =>
        args[1] === 'rm'
          ? fail('cache is locked')
          : base(command, args, options),
    );
    const report = await runActivation(activation, context);
    expect(report.outcomes.map((outcome) => outcome.status)).toEqual([
      'failed',
      'changed',
    ]);
  },
);

sandboxTest('incomplete successful downloads are not accepted', async (dir) => {
  const base = responder(dir, []);
  const { context } = await setup(
    dir,
    `models: [${REPO}]`,
    (command, args, options) =>
      args[0] === 'download' && !args.includes('--dry-run')
        ? ok(JSON.stringify({ path: snapshot(dir) }))
        : base(command, args, options),
  );
  const report = await runActivation(activation, context);
  expect(report.outcomes[0]).toMatchObject({
    status: 'failed',
    error: expect.stringContaining('incomplete'),
  });
});

sandboxTest(
  'a cached fallback or moving main cannot substitute a different commit',
  async (dir) => {
    await populate(snapshot(dir));
    const base = responder(dir, [cached(dir)], NEW_COMMIT);
    const { context } = await setup(
      dir,
      `models: [${REPO}]`,
      (command, args, options) =>
        args[0] === 'download' && !args.includes('--dry-run')
          ? ok(JSON.stringify({ path: snapshot(dir) }))
          : base(command, args, options),
    );
    const report = await runActivation(activation, context, { upgrade: true });
    expect(report.outcomes[0]).toMatchObject({
      status: 'failed',
      error: expect.stringContaining(NEW_COMMIT),
    });
  },
);

sandboxTest(
  'model failures preserve their diagnostics and finish progress',
  async (dir) => {
    const base = responder(dir, []);
    const { context } = await setup(
      dir,
      `models: [${REPO}, publisher/other]`,
      (command, args, options) =>
        args[0] === 'models' && args[2] === REPO
          ? fail('authentication required')
          : base(command, args, options),
    );
    const activities: ActivationActivity[] = [];
    const report = await runActivation(activation, context, {
      upgrade: false,
      onActivity: (event) => activities.push(event),
    });
    expect(report.outcomes.map((outcome) => outcome.status)).toEqual([
      'failed',
      'changed',
    ]);
    expect(report.outcomes[0]).toMatchObject({
      error: expect.stringContaining('authentication required'),
    });
    expect(
      activities.filter((event) => event.operation?.state === 'started'),
    ).toHaveLength(
      activities.filter((event) => event.operation?.state === 'finished')
        .length,
    );
  },
);

for (const inventory of [
  'not json',
  '{}',
  '[{}]',
  JSON.stringify([{ ...cached('/sandbox'), revision: 'main' }]),
]) {
  sandboxTest(
    `invalid cache inventory fails before model changes: ${inventory}`,
    async (dir) => {
      const { context, calls } = await setup(dir, `models: [${REPO}]`, () =>
        ok(inventory),
      );
      expect(
        outcomeStatus((await runActivation(activation, context)).outcomes),
      ).toBe('failed');
      expect(calls.filter((call) => call.command === HF)).toHaveLength(1);
    },
  );
}

for (const files of [
  '[]',
  '{}',
  '[{"file":"../escape"}]',
  '[{"file":"/escape"}]',
]) {
  sandboxTest(
    `invalid download plans cannot write files: ${files}`,
    async (dir) => {
      const base = responder(dir, []);
      const { context, calls } = await setup(
        dir,
        `models: [${REPO}]`,
        (command, args, options) =>
          args.includes('--dry-run') ? ok(files) : base(command, args, options),
      );
      expect(
        outcomeStatus((await runActivation(activation, context)).outcomes),
      ).toBe('failed');
      expect(
        calls
          .filter((call) => call.args[0] === 'download')
          .every((call) => call.args.includes('--dry-run')),
      ).toBe(true);
    },
  );
}

sandboxTest(
  'empty and invalid declarations perform no external operations',
  async (dir) => {
    for (const [raw, status] of [
      ['models: []', 'unchanged'],
      [`models: [${REPO}]\nuninstall: [${REPO}]`, 'failed'],
    ] as const) {
      const { context, calls } = await setup(dir, raw, () => {
        throw new Error('Unexpected operation');
      });
      expect(
        outcomeStatus((await runActivation(activation, context)).outcomes),
      ).toBe(status);
      expect(calls).toEqual([]);
    }
  },
);
