import { expect, test } from 'bun:test';
import type { MakeReport } from '../../provisioning/run';
import { target } from '../../provisioning/target';
import {
  renderMakeReport,
  renderPackageReport,
  renderTargetReport,
} from './makelog';

const shellTarget = target('shell', {
  description: 'shell',
  role: 'shell',
  activations: [],
});

function report(failed = false): MakeReport {
  return {
    selection: {
      targetNames: ['shell'],
      roles: ['shell'],
      packages: { taps: [], formulae: [], casks: [] },
      groups: [shellTarget],
    },
    deploys: [],
    install: [],
    groups: [
      {
        targetName: 'shell',
        blockers: [],
        reports: [
          {
            description: {
              subject: 'macOS settings',
              unchangedCollection: 'macOS settings',
            },
            outcomes: [
              {
                label: 'macOS setting com.apple.dock / autohide',
                status: 'changed',
                details: ['0 -> 1'],
              },
              {
                label: 'macOS setting com.apple.dock / tilesize',
                status: 'unchanged',
              },
              ...(failed
                ? [
                    {
                      label: 'macOS setting NSGlobalDomain / KeyRepeat',
                      status: 'failed' as const,
                      error: 'defaults write failed',
                    },
                  ]
                : [
                    {
                      label: 'macOS setting NSGlobalDomain / KeyRepeat',
                      status: 'unchanged' as const,
                    },
                  ]),
            ],
          },
        ],
      },
    ],
    failed,
  };
}

test('target report lists changes and aggregates collection no-ops', () => {
  const group = report().groups[0];
  if (!group) throw new Error('target report fixture is empty');
  const rendered = renderTargetReport(group, { isTTY: false });

  expect(rendered).toContain('shell');
  expect(rendered).toContain(
    'changed   macOS setting com.apple.dock / autohide — 0 -> 1',
  );
  expect(rendered).toContain('current   2 other macOS settings');
  expect(rendered).not.toContain('tilesize');
  expect(rendered).not.toContain('CHECK');
});

test('target report keeps failures individual', () => {
  const group = report(true).groups[0];
  if (!group) throw new Error('target report fixture is empty');
  const rendered = renderTargetReport(group, {
    isTTY: false,
  });

  expect(rendered).toContain(
    'failed    macOS setting NSGlobalDomain / KeyRepeat',
  );
  expect(rendered).toContain('defaults write failed');
  expect(rendered).toContain('current   1 other macOS settings');
});

test('package report distinguishes applied upgrades from observed changes', () => {
  const rendered = renderPackageReport(
    [
      { token: { kind: 'formula', name: 'uv' }, status: 'installed' },
      { token: { kind: 'formula', name: 'git' }, status: 'upgrade-applied' },
      { token: { kind: 'cask', name: 'zed' }, status: 'present' },
    ],
    { isTTY: false },
  );

  expect(rendered).toContain('changed   formula uv — installed');
  expect(rendered).toContain('applied   formula git');
  expect(rendered).toContain('current   1 other packages');
});

test('final report summarizes outcomes and provides a retry', () => {
  const rendered = renderMakeReport(report(true), {
    isTTY: false,
    durationMs: 123_000,
  });

  expect(rendered).toContain('Result: failed');
  expect(rendered).toContain('Duration: 2m03s');
  expect(rendered).toContain('Action required');
  expect(rendered).toContain('Retry: mev make shell');
});

test('final report counts deploy failures without rendering zero blocked resources', () => {
  const base = report();
  const blocked = {
    targetName: 'shell',
    blockers: [
      {
        kind: 'deploy' as const,
        role: 'shell',
        error: 'deploy failed',
      },
    ],
    reports: [],
  };
  const failed: MakeReport = {
    ...base,
    deploys: [{ role: 'shell', changes: [], error: 'deploy failed' }],
    groups: [blocked],
    failed: true,
  };

  expect(renderTargetReport(blocked, { isTTY: false })).not.toContain(
    'blocked 0 dependent resources',
  );
  expect(renderMakeReport(failed, { isTTY: false })).toContain(
    'Result: failed — 1 failed',
  );
});

test('final report formats durations longer than one hour', () => {
  const rendered = renderMakeReport(report(), {
    isTTY: false,
    durationMs: 7_323_000,
  });

  expect(rendered).toContain('Duration: 2h02m03s');
});
