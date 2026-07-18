import { expect, test } from 'bun:test';
import type { MakeReport } from '../../provisioning/run';
import { renderGroups, renderMakeReport } from './makelog';

const emptyPackages = { taps: [], formulae: [], casks: [] };

const failedReport: MakeReport = {
  selection: {
    tags: ['git', 'python'],
    roles: ['git', 'python'],
    packages: { taps: [], formulae: ['git', 'uv'], casks: [] },
    groups: [
      {
        tag: 'git',
        role: 'git',
        packages: { taps: [], formulae: ['git'], casks: [] },
        activations: [],
      },
      {
        tag: 'python',
        role: 'python',
        packages: { taps: [], formulae: ['uv'], casks: [] },
        activations: [],
      },
    ],
  },
  deploys: [
    { role: 'git', deployed: false, files: [] },
    { role: 'python', deployed: true, files: ['uv.toml'] },
  ],
  install: [
    { token: { kind: 'formula', name: 'git' }, status: 'present' },
    {
      token: { kind: 'formula', name: 'uv' },
      status: 'failed',
      error: 'uv unavailable',
    },
  ],
  groups: [
    {
      tag: 'git',
      blockers: [],
      reports: [
        {
          verb: 'link',
          source: 'git/global/.gitconfig',
          dest: '~/.config/git/config',
          status: 'failed',
          error: 'unmanaged file exists',
        },
      ],
    },
    {
      tag: 'python',
      blockers: [
        {
          kind: 'package',
          token: { kind: 'formula', name: 'uv' },
          error: 'uv unavailable',
        },
      ],
      reports: [
        {
          verb: 'link',
          source: 'python/global/uv.toml',
          dest: '~/.config/uv/uv.toml',
          status: 'blocked',
          error: 'formula uv: uv unavailable',
        },
      ],
    },
  ],
  failed: true,
};

test('renderGroups collapses blocked groups with the blocker reason', () => {
  const rendered = renderGroups(failedReport.groups, {
    isTTY: false,
  });

  expect(rendered).toContain('python');
  expect(rendered).toContain('blocked by formula uv: uv unavailable');
  expect(rendered).toContain('1 blocked');
  expect(rendered).not.toContain('python/global/uv.toml');
});

test('renderMakeReport summarizes failed and blocked targets', () => {
  const rendered = renderMakeReport(failedReport, {
    isTTY: false,
    durationMs: 123_000,
  });

  expect(rendered).toContain('Result: failed');
  expect(rendered).toContain('Duration: 2m03s');
  expect(rendered).toContain(
    'Targets: 2 selected, 0 completed, 1 failed, 1 blocked',
  );
  expect(rendered).toContain('git failed during activation');
  expect(rendered).toContain('unmanaged file exists');
  expect(rendered).toContain('python blocked by failed package');
  expect(rendered).toContain('formula uv: uv unavailable');
  expect(rendered).toContain('Brew: 0 installed, 1 already present, 1 failed');
  expect(rendered).toContain('Activation: 1 failed, 1 blocked');
  expect(rendered).toContain('mev make git python');
});

test('renderMakeReport renders concise successful summaries', () => {
  const report: MakeReport = {
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
    deploys: [{ role: 'shell', deployed: false, files: [] }],
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
            status: 'unchanged',
          },
        ],
      },
    ],
    failed: false,
  };

  const rendered = renderMakeReport(report, {
    isTTY: false,
    durationMs: 999,
  });

  expect(rendered).toContain('Result: success');
  expect(rendered).toContain('Targets: 1 completed');
  expect(rendered).toContain('Activation: 1 unchanged');
  expect(rendered).not.toContain('Action required');
  expect(rendered).not.toContain('Retry');
});
