import { expect, test } from 'bun:test';
import { renderNamespaceOverview } from './namespace-overview';

const definitions = [
  {
    path: 'mev config',
    usage: '$ mev config',
    category: 'config',
    description: 'Show config subcommands.',
  },
  {
    path: 'mev config agents',
    usage: '$ mev config agents',
    category: 'config',
    description: 'Select sections.',
  },
  {
    path: 'mev config zed',
    usage: '$ mev config zed',
    category: 'config',
    description: 'Select overrides.',
  },
  {
    path: 'mev make',
    usage: '$ mev make',
    category: 'provisioning',
    description: 'Provision.',
  },
];

test('lists the category subcommands under a header', () => {
  const output = renderNamespaceOverview({
    binaryName: 'mev',
    invokedPath: ['config'],
    canonicalPath: ['config'],
    category: 'config',
    definitions,
  });

  expect(output).toContain('mev config <command>');
  expect(output).toContain('mev config agents');
  expect(output).toContain('Select sections.');
  // The namespace's own overview is excluded by structural path match.
  expect(output).not.toContain('Show config subcommands.');
  // Commands from other categories are excluded.
  expect(output).not.toContain('mev make');
});

test('renders the invoked alias path in the header', () => {
  const output = renderNamespaceOverview({
    binaryName: 'mev',
    invokedPath: ['cf'],
    canonicalPath: ['config'],
    category: 'config',
    definitions,
  });

  expect(output).toContain('mev cf <command>');
});
