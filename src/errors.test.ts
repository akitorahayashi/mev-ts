import { expect, test } from 'bun:test';
import { AppError, errorMessage, ProvisioningError } from './errors';

test('AppError reports its concrete subclass name', () => {
  expect(new AppError('base').name).toBe('AppError');
  expect(new ProvisioningError('provisioning').name).toBe('ProvisioningError');
});

test('errorMessage renders unknown thrown values', () => {
  expect(errorMessage(new Error('boom'))).toBe('boom');
  expect(errorMessage('plain')).toBe('plain');
  expect(errorMessage(7)).toBe('7');
});

test('errorMessage renders attached cleanup failures after the primary failure', () => {
  const primary = new Error('write failed');
  Object.defineProperty(primary, 'cleanupError', {
    value: new Error('remove failed'),
  });

  expect(errorMessage(primary)).toBe(
    'write failed; cleanup failed: remove failed',
  );
});

test('errorMessage renders aggregate failure causes', () => {
  const error = new AggregateError(
    ['write failed', new Error('remove failed')],
    'Transaction failed',
  );

  expect(errorMessage(error)).toBe(
    'Transaction failed; causes: write failed; remove failed',
  );
});
