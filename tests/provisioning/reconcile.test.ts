import { expect, test } from 'bun:test';
import { ProvisioningError } from '../../src/errors';
import type {
  Described,
  StepReport,
} from '../../src/provisioning/activation/contract';
import {
  type ReconcileStep,
  reconcile,
} from '../../src/provisioning/activation/reconcile';

const base: Described = { verb: 'apply', source: 'src', dest: 'dst' };

function step(report: StepReport): ReconcileStep {
  return { run: async () => report, onError: () => report };
}

function throwingStep(key: string, error: unknown): ReconcileStep {
  return {
    run: async () => {
      throw error;
    },
    onError: () => ({
      key,
      value: 'boom',
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
    }),
  };
}

test('a throwing step fails only itself; its siblings still run', async () => {
  const report = await reconcile(base, false, {
    declare: async () => [0, 1, 2],
    steps: async () => [
      step({ key: 'a', value: 'a', status: 'changed' }),
      throwingStep('b', new Error('spawn ENOENT')),
      step({ key: 'c', value: 'c', status: 'unchanged' }),
    ],
  });

  expect(report.status).toBe('failed');
  expect(report.entries?.map((e) => e.status)).toEqual([
    'changed',
    'failed',
    'unchanged',
  ]);
  expect(report.entries?.[1]?.error).toBe('spawn ENOENT');
});

test('concurrent runs report in declaration order, not completion order', async () => {
  const slowFirst: ReconcileStep = {
    run: async () => {
      await Bun.sleep(15);
      return { key: 'first', value: 'first', status: 'changed' };
    },
    onError: () => ({ key: 'first', value: '', status: 'failed' }),
  };
  const fastSecond = step({
    key: 'second',
    value: 'second',
    status: 'unchanged',
  });

  const report = await reconcile(base, false, {
    declare: async () => [0, 1],
    concurrent: true,
    steps: async () => [slowFirst, fastSecond],
  });

  expect(report.entries?.map((e) => e.key)).toEqual(['first', 'second']);
});

test('failed outranks changed in the aggregated status', async () => {
  const report = await reconcile(base, false, {
    declare: async () => [0, 1],
    steps: async () => [
      step({ key: 'a', value: 'a', status: 'changed' }),
      step({ key: 'b', value: 'b', status: 'failed', error: 'x' }),
    ],
  });
  expect(report.status).toBe('failed');
});

test('plan mode runs declare only; no step is built or run', async () => {
  let declared = 0;
  let built = 0;
  const report = await reconcile(base, true, {
    declare: async () => {
      declared += 1;
      return [0];
    },
    steps: async () => {
      built += 1;
      return [];
    },
  });

  expect(report.status).toBe('changed');
  expect(report.entries).toBeUndefined();
  expect(declared).toBe(1);
  expect(built).toBe(0);
});

test('a failure from declare is a whole-activation error', async () => {
  const report = await reconcile(base, false, {
    declare: async () => {
      throw new ProvisioningError('manifest missing');
    },
    steps: async () => [],
  });

  expect(report.status).toBe('failed');
  expect(report.error).toBe('manifest missing');
  expect(report.entries).toBeUndefined();
});

test('a shared-probe failure raised in steps is a whole-activation error', async () => {
  const report = await reconcile(base, false, {
    declare: async () => [0, 1],
    steps: async () => {
      throw new ProvisioningError('probe failed');
    },
  });

  expect(report.status).toBe('failed');
  expect(report.error).toBe('probe failed');
  expect(report.entries).toBeUndefined();
});

test('an empty declaration reports unchanged with no entries', async () => {
  const report = await reconcile(base, false, {
    declare: async () => [],
    steps: async () => [],
  });

  expect(report.status).toBe('unchanged');
  expect(report.entries).toEqual([]);
});

test('an empty declaration reports unchanged in plan mode too', async () => {
  const report = await reconcile(base, true, {
    declare: async () => [],
    steps: async () => [],
  });

  expect(report.status).toBe('unchanged');
  expect(report.entries).toEqual([]);
});
