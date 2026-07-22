import { expect, test } from 'bun:test';
import type { MakeReport, MakeRequest } from '../provisioning/run';
import {
  executeProvisioningRun,
  type ProvisioningRun,
} from './provisioning-run';

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
      targetNames: ['shell'],
      roles: ['shell'],
      packages: emptyPackages,
      groups: [
        {
          targetName: 'shell',
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
        targetName: 'shell',
        blockers: [],
        reports: [
          {
            verb: 'link',
            source: 'shell/.zshenv',
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
      request.onActivationPhaseStart?.({ totalTargets: report.groups.length });
      for (const group of report.groups) {
        for (const activation of group.reports) {
          request.onActivationStart?.({
            targetName: group.targetName,
            activation: {
              verb: activation.verb,
              source: activation.source,
              dest: activation.dest,
            },
          });
        }
        request.onActivationTargetComplete?.(group);
      }
      return report;
    },
  };
}

test('executeProvisioningRun renders a successful run and returns zero', async () => {
  const { run, requests } = runReturning(reportWithStatus('unchanged'));

  const result = await capture({
    selectors: ['shell'],
    intro: 'mev: Creating personal environment',
    footer: () => ['Optional', 'Baseline Homebrew casks: mev make br-c'],
    run,
  });

  expect(result.code).toBe(0);
  expect(requests[0]?.selectors).toEqual(['shell']);
  expect(result.stdout).toContain('mev: Creating personal environment');
  expect(result.stdout).toContain('Deployed config for shell  .zshenv');
  expect(result.stdout).toContain('Running targets: shell');
  expect(result.stdout).toContain(
    'Activating shell: link shell/.zshenv -> ~/.zshenv',
  );
  expect(result.stdout).toContain('shell: unchanged');
  expect(result.stdout).toContain('Result: success');
  expect(result.stdout).not.toContain('Summary');
  expect(result.stdout).toContain('Optional');
  expect(result.stdout).toContain('Baseline Homebrew casks: mev make br-c');
});

test('executeProvisioningRun drives animated progress on an injected TTY stream', async () => {
  const { run } = runReturning(reportWithStatus('changed'));
  // Inline fake terminal (kept hermetic: no fixtures import in a colocated test).
  let terminal = '';
  const stream = {
    isTTY: true,
    columns: 80,
    write(chunk: unknown) {
      terminal += String(chunk);
      return true;
    },
  } as unknown as NodeJS.WriteStream;

  const code = await executeProvisioningRun({
    selectors: ['shell'],
    run,
    out: () => {},
    isTTY: true,
    stream,
  });

  expect(code).toBe(0);
  // The TTY path renders the in-flight activation line to the injected stream,
  // instead of process.stdout, so it is observable in a test.
  expect(Bun.stripANSI(terminal)).toContain('link shell/.zshenv -> ~/.zshenv');
});

test('executeProvisioningRun renders failed runs without success footer', async () => {
  const { run } = runReturning(reportWithStatus('failed'));

  const result = await capture({
    selectors: ['shell'],
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
