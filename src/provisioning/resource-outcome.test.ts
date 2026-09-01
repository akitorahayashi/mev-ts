import { expect, test } from 'bun:test';
import {
  outcomeStatus,
  outcomeSucceeded,
  type ResourceOutcome,
} from './resource-outcome';

function outcome(status: ResourceOutcome['status']): ResourceOutcome {
  if (status === 'failed') {
    return { label: status, status, error: 'failed' };
  }
  if (status === 'blocked') {
    return { label: status, status, reason: 'blocked' };
  }
  return { label: status, status };
}

test('outcome status follows failure, block, change, apply, current priority', () => {
  expect(outcomeStatus([outcome('unchanged')])).toBe('unchanged');
  expect(outcomeStatus([outcome('unchanged'), outcome('applied')])).toBe(
    'applied',
  );
  expect(outcomeStatus([outcome('applied'), outcome('changed')])).toBe(
    'changed',
  );
  expect(outcomeStatus([outcome('changed'), outcome('blocked')])).toBe(
    'blocked',
  );
  expect(outcomeStatus([outcome('blocked'), outcome('failed')])).toBe('failed');
});

test('applied is a successful outcome despite an unobserved state difference', () => {
  expect(outcomeSucceeded('applied')).toBe(true);
  expect(outcomeSucceeded('failed')).toBe(false);
  expect(outcomeSucceeded('blocked')).toBe(false);
});
