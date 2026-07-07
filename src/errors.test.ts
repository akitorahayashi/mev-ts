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
