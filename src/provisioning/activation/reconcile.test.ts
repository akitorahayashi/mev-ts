import { expect, test } from 'bun:test';
import { errorMessage, ProvisioningError } from '../../errors';
import { outcomeStatus } from '../resource-outcome';
import { reportActivity } from './activity';
import type { ActivationDescription, ReconcileItemResult } from './contract';
import { activationReport, type ReconcileStep, reconcile } from './reconcile';

const base: ActivationDescription = { subject: 'dst' };
function step(report: ReconcileItemResult): ReconcileStep {
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
      error: errorMessage(error),
    }),
  };
}
for (const concurrent of [undefined, 2]) {
  test(`activity observer errors escape the ${concurrent ? 'concurrent' : 'serial'} reconcile boundary unchanged`, async () => {
    const failure = new Error('output unavailable');
    let itemErrorHandled = false;
    const running = reconcile(base, {
      declare: async () => [0],
      concurrent,
      steps: async () => [
        {
          async run() {
            reportActivity(
              () => {
                throw failure;
              },
              { action: 'check', subject: 'binary' },
            );
            return { key: 'binary', value: '', status: 'unchanged' };
          },
          onError() {
            itemErrorHandled = true;
            return { key: 'binary', value: '', status: 'failed' };
          },
        },
      ],
    });
    await expect(running).rejects.toBe(failure);
    expect(itemErrorHandled).toBe(false);
  });
}
test('a throwing step fails only itself; its siblings still run', async () => {
  const report = await reconcile(base, {
    declare: async () => [0, 1, 2],
    steps: async () => [
      step({ key: 'a', value: 'a', status: 'changed' }),
      throwingStep('b', new Error('spawn ENOENT')),
      step({ key: 'c', value: 'c', status: 'unchanged' }),
    ],
  });
  expect(outcomeStatus(report.outcomes)).toBe('failed');
  expect(report.outcomes.map((e) => e.status)).toEqual([
    'changed',
    'failed',
    'unchanged',
  ]);
  expect(report.outcomes[1]).toMatchObject({
    status: 'failed',
    error: 'spawn ENOENT',
  });
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
  const report = await reconcile(base, {
    declare: async () => [0, 1],
    concurrent: 2,
    steps: async () => [slowFirst, fastSecond],
  });
  expect(report.outcomes.map((e) => e?.label)).toEqual(['first', 'second']);
});
test('failed outranks changed in the aggregated status', async () => {
  const report = await reconcile(base, {
    declare: async () => [0, 1],
    steps: async () => [
      step({ key: 'a', value: 'a', status: 'changed' }),
      step({ key: 'b', value: 'b', status: 'failed', error: 'x' }),
    ],
  });
  expect(outcomeStatus(report.outcomes)).toBe('failed');
});
test('a failure from declare is a whole-activation error', async () => {
  const report = await reconcile(base, {
    declare: async () => {
      throw new ProvisioningError('manifest missing');
    },
    steps: async () => [],
  });
  expect(outcomeStatus(report.outcomes)).toBe('failed');
  expect(report.outcomes).toEqual([
    { label: 'dst', status: 'failed', error: 'manifest missing' },
  ]);
});
test('a shared-probe failure raised in steps is a whole-activation error', async () => {
  const report = await reconcile(base, {
    declare: async () => [0, 1],
    steps: async () => {
      throw new ProvisioningError('probe failed');
    },
  });
  expect(outcomeStatus(report.outcomes)).toBe('failed');
  expect(report.outcomes).toEqual([
    { label: 'dst', status: 'failed', error: 'probe failed' },
  ]);
});
test('an empty declaration reports unchanged with no resource outcomes', async () => {
  const report = await reconcile(base, {
    declare: async () => [],
    steps: async () => [],
  });
  expect(outcomeStatus(report.outcomes)).toBe('unchanged');
  expect(report.outcomes).toEqual([]);
});

test('blocked resources and activation notices remain available in the canonical result', () => {
  const report = activationReport(
    base,
    [
      { label: 'first', status: 'changed', details: ['configured'] },
      {
        label: 'second',
        status: 'blocked',
        reason: 'required input unavailable',
      },
    ],
    ['stale selection ignored'],
  );
  expect(report.outcomes).toEqual([
    { label: 'first', status: 'changed', details: ['configured'] },
    {
      label: 'second',
      status: 'blocked',
      reason: 'required input unavailable',
    },
  ]);
  expect(outcomeStatus(report.outcomes)).toBe('blocked');
  expect(report.notices).toEqual(['stale selection ignored']);
});
