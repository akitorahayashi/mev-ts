import { expect, test } from 'bun:test';
import type { MakeReport, MakeRequest } from '../../provisioning/run';
import { executeProvisioningRun, type ProvisioningRun } from './provisioning';

const emptyPackages = { taps: [], formulae: [], casks: [] };

interface CaptureResult {
  readonly code: number;
  readonly stdout: string;
}

type ProvisioningOptions = Parameters<typeof executeProvisioningRun>[0];

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

async function capture(
  options: Omit<ProvisioningOptions, 'out' | 'isTTY'>,
): Promise<CaptureResult> {
  let stdout = '';
  const code = await executeProvisioningRun({
    ...options,
    isTTY: false,
    out: (text) => {
      stdout += text;
    },
  });
  return { code, stdout: Bun.stripANSI(stdout) };
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
      request.onInstallTokenStart?.({ kind: 'formula', name: 'git' });
      request.onInstallTick?.({ kind: 'formula', name: 'git' });
      return report;
    },
  };
}

test('executeProvisioningRun renders a successful run and returns zero', async () => {
  const { run, requests } = runReturning(reportWithStatus('unchanged'));

  const result = await capture({
    tags: ['shell'],
    overwrite: true,
    intro: 'mev: Creating personal environment',
    footer: () => ['Optional', 'Baseline Homebrew casks: mev make br-c'],
    run,
  });

  expect(result.code).toBe(0);
  expect(requests[0]?.tags).toEqual(['shell']);
  expect(result.stdout).toContain('mev: Creating personal environment');
  expect(result.stdout).toContain('Deployed config for shell  .zshenv');
  expect(result.stdout).toContain('Running tags: shell');
  expect(result.stdout).toContain('shell  1 unchanged');
  expect(result.stdout).toContain('Result: success');
  expect(result.stdout).toContain('Optional');
  expect(result.stdout).toContain('Baseline Homebrew casks: mev make br-c');
});

test('executeProvisioningRun renders failed runs without success footer', async () => {
  const { run } = runReturning(reportWithStatus('failed'));

  const result = await capture({
    tags: ['shell'],
    overwrite: false,
    footer: (report) =>
      report.failed
        ? undefined
        : ['Optional', 'Baseline Homebrew casks: mev make br-c'],
    run,
  });

  expect(result.code).toBe(1);
  expect(result.stdout).toContain('Result: failed');
  expect(result.stdout).toContain('shell failed during activation');
  expect(result.stdout).toContain('Retry');
  expect(result.stdout).not.toContain('Optional');
});
