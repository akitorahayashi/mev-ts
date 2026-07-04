import { expect, test } from 'bun:test';
import { AppError, ProvisioningError } from './errors';

test('AppError reports its concrete subclass name', () => {
  expect(new AppError('base').name).toBe('AppError');
  expect(new ProvisioningError('provisioning').name).toBe('ProvisioningError');
});
