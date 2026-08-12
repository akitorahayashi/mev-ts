import { expect, test } from 'bun:test';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ProvisioningError } from '../../src/errors';
import type { CommandRunner } from '../../src/host/command';
import { downloadOverHttps } from '../../src/host/https-download';
import { withTemporaryDirectory } from '../fixtures/temporary-directory';

const URL = 'https://github.com/akitorahayashi/kpv/releases/download/v1/kpv';

function curlRunner(
  body: string,
  result: { code: number; stdout?: string; stderr?: string },
): CommandRunner {
  return {
    async run(_command, args) {
      const output = args[args.indexOf('-o') + 1] as string;
      await writeFile(output, body);
      return { stdout: '', stderr: '', ...result };
    },
  };
}

async function rejection(promise: Promise<void>): Promise<ProvisioningError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ProvisioningError);
    return error as ProvisioningError;
  }
  throw new Error('expected the download to reject');
}

test('a successful download writes the output and resolves', async () => {
  await withTemporaryDirectory(async (dir) => {
    const output = join(dir, 'asset');
    const run = curlRunner('bytes', { code: 0, stdout: '200' });

    await downloadOverHttps(run, URL, output, 'kpv');

    expect(await readFile(output, 'utf8')).toBe('bytes');
  });
});

test('an HTTP failure reports the status and the response body', async () => {
  await withTemporaryDirectory(async (dir) => {
    const output = join(dir, 'asset');
    // curl exit 22 is the --fail-with-body HTTP-error signal; the body it
    // leaves behind carries the server's explanation.
    const run = curlRunner(
      '{"message":"API rate limit exceeded for 203.0.113.7."}\n',
      { code: 22, stdout: '403', stderr: 'curl: (22) HTTP error' },
    );

    const error = await rejection(downloadOverHttps(run, URL, output, 'kpv'));

    expect(error.message).toContain('kpv');
    expect(error.message).toContain('HTTP 403');
    expect(error.message).toContain('API rate limit exceeded');
  });
});

test('a transport failure reports curl stderr, not an HTTP status', async () => {
  const run: CommandRunner = {
    async run() {
      return { code: 6, stdout: '', stderr: 'Could not resolve host' };
    },
  };

  const error = await rejection(
    downloadOverHttps(run, URL, '/dev/null', 'kpv'),
  );

  expect(error.message).toContain('Could not resolve host');
  expect(error.message).not.toContain('HTTP');
});
