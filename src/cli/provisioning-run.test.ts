import { expect, test } from 'bun:test';
import type { MakeReport, MakeRequest } from '../provisioning/run';
import { target } from '../provisioning/target';
import {
  executeProvisioningRun,
  type ProvisioningRun,
} from './provisioning-run';

const shellTarget = target('shell', {
  description: 'shell',
  role: 'shell',
  activations: [],
});

function makeReport(status: 'changed' | 'unchanged' | 'failed'): MakeReport {
  return {
    selection: {
      targetNames: ['shell'],
      roles: ['shell'],
      packages: { taps: [], formulae: ['git'], casks: [] },
      groups: [shellTarget],
    },
    deploys: [],
    install: [{ token: { kind: 'formula', name: 'git' }, status: 'present' }],
    groups: [
      {
        targetName: 'shell',
        blockers: [],
        reports: [
          {
            description: { subject: '~/.zshrc' },
            outcomes: [
              status === 'failed'
                ? {
                    label: '~/.zshrc',
                    status,
                    error: 'link failed',
                  }
                : {
                    label: '~/.zshrc',
                    status,
                    details: [
                      status === 'changed'
                        ? 'managed content updated'
                        : 'already linked to current managed config',
                    ],
                  },
            ],
          },
        ],
      },
    ],
    failed: status === 'failed',
  };
}

function fakeRun(report: MakeReport): {
  readonly requests: MakeRequest[];
  readonly run: ProvisioningRun;
} {
  const requests: MakeRequest[] = [];
  return {
    requests,
    async run(request) {
      requests.push(request);
      request.onEvent?.({ type: 'selection', selection: report.selection });
      request.onEvent?.({
        type: 'package-phase-start',
        total: report.install.length,
      });
      request.onEvent?.({
        type: 'package-phase-complete',
        reports: report.install,
      });
      request.onEvent?.({ type: 'activation-phase-start' });
      for (const group of report.groups) {
        for (const activation of group.reports) {
          request.onEvent?.({
            type: 'activation-start',
            targetName: group.targetName,
            activation: activation.description,
          });
        }
        request.onEvent?.({ type: 'target-complete', group });
      }
      return report;
    },
  };
}

async function capture(
  report: MakeReport,
  options: { readonly upgrade?: boolean; readonly intro?: string } = {},
): Promise<{
  readonly code: number;
  readonly output: string;
  readonly request: MakeRequest;
}> {
  let output = '';
  const stream = {
    write(chunk: unknown) {
      output += String(chunk);
      return true;
    },
  } as unknown as NodeJS.WriteStream;
  const { run, requests } = fakeRun(report);
  const code = await executeProvisioningRun({
    selectors: ['shell'],
    run,
    stream,
    ...options,
  });
  const request = requests[0];
  if (!request) throw new Error('provisioning run was not invoked');
  return { code, output: Bun.stripANSI(output), request };
}

test('a successful run emits resource results without internal deploy checks', async () => {
  const result = await capture(makeReport('unchanged'), {
    intro: 'Creating environment',
  });

  expect(result.code).toBe(0);
  expect(result.output).toContain('Homebrew');
  expect(result.output).toContain('current   1 packages');
  expect(result.output).toContain('shell');
  expect(result.output).toContain('current   ~/.zshrc');
  expect(result.output).toContain('Result: success');
  expect(result.output).not.toContain('Deployed config');
  expect(result.output).not.toContain('Running targets');
  expect(result.output).not.toContain('CHECK');
});

test('upgrade intent is forwarded', async () => {
  const result = await capture(makeReport('changed'), { upgrade: true });
  expect(result.request.upgrade).toBe(true);
});

test('a failed run emits the resource error and retry command', async () => {
  const result = await capture(makeReport('failed'));
  expect(result.code).toBe(1);
  expect(result.output).toContain('failed    ~/.zshrc — link failed');
  expect(result.output).toContain('Retry: mev make shell');
});
