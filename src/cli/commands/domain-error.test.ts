import { expect, test } from 'bun:test';
import { Writable } from 'node:stream';
import { AppError } from '../../errors';
import { runReportingDomainErrors } from './domain-error';

test('domain error reporting includes cleanup failures', async () => {
  let output = '';
  const stderr = new Writable({
    write(chunk, _encoding, callback) {
      output += chunk.toString();
      callback();
    },
  });
  const primary = new AppError('activation failed');
  Object.defineProperty(primary, 'cleanupError', {
    value: new Error('transaction removal failed'),
  });

  const code = await runReportingDomainErrors(stderr, async () => {
    throw primary;
  });

  expect(code).toBe(1);
  expect(output).toBe(
    'AppError: activation failed; cleanup failed: transaction removal failed\n',
  );
});
