import { expect, test } from 'bun:test';
import type { MakeReport } from '../../provisioning/run';
import {
  renderMakeReport,
  renderTargetCompletionLine,
  summarizeActivationGroup,
} from './makelog';

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

test('renderTargetCompletionLine summarizes changed groups by outcome kind', () => {
  const rendered = renderTargetCompletionLine(
    {
      tag: 'shell',
      blockers: [],
      reports: [
        {
          verb: 'link',
          source: 'shell/global/.zshenv',
          dest: '~/.zshenv',
          status: 'changed',
        },
        {
          verb: 'apply',
          source: 'macos/defaults',
          dest: 'defaults',
          status: 'changed',
          entries: [
            { key: 'Dock autohide', value: 'true', status: 'changed' },
            { key: 'Key repeat', value: 'fast', status: 'changed' },
            { key: 'Finder path bar', value: 'true', status: 'unchanged' },
          ],
        },
      ],
    },
    { isTTY: false },
  );

  expect(rendered).toBe('shell: changed  1 linked, 2 applied');
});

test('renderTargetCompletionLine summarizes failed and blocked groups', () => {
  const [git, python] = failedReport.groups;
  if (!git || !python) throw new Error('failed report fixture is incomplete');

  expect(renderTargetCompletionLine(git, { isTTY: false })).toBe(
    'git: failed  link git/global/.gitconfig -> ~/.config/git/config',
  );
  expect(renderTargetCompletionLine(python, { isTTY: false })).toBe(
    'python: blocked  formula uv failed',
  );
  expect(summarizeActivationGroup(python)).toBe('formula uv failed');
});

test('renderMakeReport summarizes failed and blocked targets', () => {
  const rendered = renderMakeReport(failedReport, {
    isTTY: false,
    durationMs: 123_000,
  });

  expect(rendered).toContain('Result: failed');
  expect(rendered).toContain('Duration: 2m03s');
  expect(rendered).toContain('git failed during activation');
  expect(rendered).toContain('unmanaged file exists');
  expect(rendered).toContain('python blocked by failed package');
  expect(rendered).toContain('formula uv: uv unavailable');
  expect(rendered).toContain('mev make git python');
  expect(rendered).not.toContain('Targets:');
  expect(rendered).not.toContain('Summary');
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
    durationMs: 1,
  });

  expect(rendered).toContain('Result: success');
  expect(rendered).toContain('Duration: <1s');
  expect(rendered).toContain('Mode: apply');
  expect(rendered).not.toContain('Targets:');
  expect(rendered).not.toContain('Summary');
  expect(rendered).not.toContain('Activation:');
  expect(rendered).not.toContain('Action required');
  expect(rendered).not.toContain('Retry');
});
