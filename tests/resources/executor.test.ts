import { expect, test } from 'bun:test';
import { applyGraph, planGraph } from '../../src/mev/resources/executor';
import { buildGraph } from '../../src/mev/resources/graph';
import type {
  ConcurrencyGroup,
  Context,
  Resource,
  StateKind,
} from '../../src/mev/resources/model';

const context: Context = {
  home: '/sandbox',
  overwrite: false,
  commands: {
    async run() {
      return { code: 0, stdout: '', stderr: '' };
    },
  },
  assets: {
    async read() {
      return '';
    },
  },
};

interface StubSpec {
  readonly id: string;
  readonly deps?: string[];
  readonly group?: ConcurrencyGroup;
  readonly state?: StateKind;
  readonly inspectThrows?: boolean;
  readonly applyThrows?: boolean;
  readonly onApply?: () => Promise<void> | void;
}

function stub(spec: StubSpec): Resource {
  return {
    id: spec.id,
    dependencies: spec.deps ?? [],
    concurrencyGroup: spec.group ?? 'filesystem',
    async inspect() {
      if (spec.inspectThrows) {
        throw new Error('inspect failed');
      }
      return { kind: spec.state ?? 'missing' };
    },
    async apply() {
      await spec.onApply?.();
      if (spec.applyThrows) {
        throw new Error('apply failed');
      }
      return {};
    },
  };
}

const delay = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

function outcomeOf(reports: { id: string; outcome: string }[], id: string) {
  return reports.find((report) => report.id === id)?.outcome;
}

test('plan reports would-change without applying', async () => {
  const applied: string[] = [];
  const graph = buildGraph([
    stub({ id: 'present', state: 'present' }),
    stub({
      id: 'missing',
      state: 'missing',
      onApply: () => {
        applied.push('missing');
      },
    }),
    stub({ id: 'broken', inspectThrows: true }),
  ]);

  const reports = await planGraph(graph, context);

  expect(outcomeOf(reports, 'present')).toBe('unchanged');
  expect(outcomeOf(reports, 'missing')).toBe('changed');
  expect(outcomeOf(reports, 'broken')).toBe('failed');
  expect(applied).toEqual([]);
});

test('apply changes only diverged resources', async () => {
  const applied: string[] = [];
  const graph = buildGraph([
    stub({
      id: 'present',
      state: 'present',
      onApply: () => {
        applied.push('present');
      },
    }),
    stub({
      id: 'missing',
      state: 'missing',
      onApply: () => {
        applied.push('missing');
      },
    }),
  ]);

  const reports = await applyGraph(graph, context);

  expect(outcomeOf(reports, 'present')).toBe('unchanged');
  expect(outcomeOf(reports, 'missing')).toBe('changed');
  expect(applied).toEqual(['missing']);
});

test('applies a dependency before its dependent', async () => {
  const order: string[] = [];
  const graph = buildGraph([
    stub({
      id: 'b',
      deps: ['a'],
      onApply: () => {
        order.push('b');
      },
    }),
    stub({
      id: 'a',
      onApply: () => {
        order.push('a');
      },
    }),
  ]);

  await applyGraph(graph, context);

  expect(order).toEqual(['a', 'b']);
});

test('blocks dependents of a failed resource while independents continue', async () => {
  const graph = buildGraph([
    stub({ id: 'a', applyThrows: true }),
    stub({ id: 'b', deps: ['a'] }),
    stub({ id: 'c' }),
  ]);

  const reports = await applyGraph(graph, context);

  expect(outcomeOf(reports, 'a')).toBe('failed');
  expect(outcomeOf(reports, 'b')).toBe('blocked');
  expect(outcomeOf(reports, 'c')).toBe('changed');
});

test('serializes a concurrency group limited to one', async () => {
  let active = 0;
  let peak = 0;
  const track = async () => {
    active += 1;
    peak = Math.max(peak, active);
    await delay(15);
    active -= 1;
  };
  const graph = buildGraph([
    stub({ id: 'brew-a', group: 'homebrew', onApply: track }),
    stub({ id: 'brew-b', group: 'homebrew', onApply: track }),
  ]);

  await applyGraph(graph, context);

  expect(peak).toBe(1);
});

test('runs independent resources in a wide group concurrently', async () => {
  let active = 0;
  let peak = 0;
  const track = async () => {
    active += 1;
    peak = Math.max(peak, active);
    await delay(15);
    active -= 1;
  };
  const graph = buildGraph([
    stub({ id: 'fs-a', group: 'filesystem', onApply: track }),
    stub({ id: 'fs-b', group: 'filesystem', onApply: track }),
    stub({ id: 'fs-c', group: 'filesystem', onApply: track }),
  ]);

  await applyGraph(graph, context);

  expect(peak).toBe(3);
});
