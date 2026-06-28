import { expect, test } from 'bun:test';
import type { MakeReport, MakeRequest } from '../../provisioning/run';
import { executeProvisioningRun, type ProvisioningRun } from './provisioning';

const emptyPackages = { taps: [], formulae: [], casks: [] };

interface CaptureResult {
  readonly code: number;
  readonly stdout: string;
}

function reportWithStatus(
  status: MakeReport['groups'][number]['reports'][number]['status'],
): MakeReport {
  const failed = status === 'failed';
  return {
    selection: {
      tags: ['shell'],
      roles: ['shell'],
      packages: emptyPackages,
      groups: [
        {
          tag: 'shell',
          role: 'shell',
          packages: emptyPackages,
          activations: [],
        },
      ],
    },
    deploys: [{ role: 'shell', deployed: true, files: ['.zshenv'] }],
    install: [],
    groups: [
      {
        tag: 'shell',
        blockers: [],
        reports: [
          {
            verb: 'link',
            source: 'shell/global/.zshenv',
            dest: '~/.zshenv',
            status,
            error: failed ? 'link failed' : undefined,
          },
        ],
      },
    ],
    failed,
  };
}

async function capture(action: () => Promise<number>): Promise<CaptureResult> {
  let stdout = '';
  const originalStdout = process.stdout.write;
  process.stdout.write = ((
    chunk: unknown,
    encoding?: unknown,
    cb?: unknown,
  ) => {
    stdout +=
      chunk instanceof Uint8Array
        ? Buffer.from(chunk).toString()
        : String(chunk);
    if (typeof encoding === 'function') encoding();
    if (typeof cb === 'function') cb();
    return true;
  }) as typeof process.stdout.write;

  try {
    const code = await action();
    return { code, stdout: Bun.stripANSI(stdout) };
  } finally {
    process.stdout.write = originalStdout;
  }
}

function runReturning(report: MakeReport): {
  readonly requests: MakeRequest[];
  readonly run: ProvisioningRun;
} {
  const requests: MakeRequest[] = [];
  return {
    requests,
    async run(request) {
      requests.push(request);
      const deploy = report.deploys[0];
      if (deploy) request.onDeploy?.(deploy);
      request.onHeader?.(report.selection);
      request.onInstallStart?.(1);
      request.onInstallTokenStart?.(
        { kind: 'formula', name: 'git' },
        'checking',
      );
      request.onInstallTick?.({ kind: 'formula', name: 'git' });
      return report;
    },
  };
}

test('executeProvisioningRun renders a successful run and returns zero', async () => {
  const { run, requests } = runReturning(reportWithStatus('unchanged'));

  const result = await capture(() =>
    executeProvisioningRun({
      tags: ['shell'],
      plan: false,
      overwrite: true,
      intro: 'mev: Creating personal environment',
      footer: () => ['Optional', 'GUI applications: mev make br-c'],
      run,
    }),
  );

  expect(result.code).toBe(0);
  expect(requests[0]?.tags).toEqual(['shell']);
  expect(requests[0]?.plan).toBe(false);
  expect(requests[0]?.overwrite).toBe(true);
  expect(result.stdout).toContain('mev: Creating personal environment');
  expect(result.stdout).toContain('Deployed config for shell  .zshenv');
  expect(result.stdout).toContain('Running tags: shell');
  expect(result.stdout).toContain('shell  1 unchanged');
  expect(result.stdout).toContain('Result: success');
  expect(result.stdout).toContain('Optional');
  expect(result.stdout).toContain('GUI applications: mev make br-c');
});

test('executeProvisioningRun renders failed runs without success footer', async () => {
  const { run } = runReturning(reportWithStatus('failed'));

  const result = await capture(() =>
    executeProvisioningRun({
      tags: ['shell'],
      plan: false,
      overwrite: false,
      footer: (report) =>
        report.failed
          ? undefined
          : ['Optional', 'GUI applications: mev make br-c'],
      run,
    }),
  );

  expect(result.code).toBe(1);
  expect(result.stdout).toContain('Result: failed');
  expect(result.stdout).toContain('shell failed during activation');
  expect(result.stdout).toContain('Retry');
  expect(result.stdout).not.toContain('Optional');
});
