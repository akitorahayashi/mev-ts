import { expect, test } from 'bun:test';
import { renderNamespaceOverview } from './namespace-overview';

// clipanion's `definitions()` returns `category` and `description` with a
// trailing newline (`formatMarkdownish`), so the fixture models that shape.
const definitions = [
  {
    path: 'mev config',
    usage: '$ mev config',
    category: 'config\n',
    description: 'Show config subcommands.\n',
  },
  {
    path: 'mev config agents',
    usage: '$ mev config agents',
    category: 'config\n',
    description: 'Select sections.\n',
  },
  {
    path: 'mev config zed',
    usage: '$ mev config zed',
    category: 'config\n',
    description: 'Select overrides.\n',
  },
  {
    path: 'mev make',
    usage: '$ mev make',
    category: 'provisioning\n',
    description: 'Provision.\n',
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
  // The trailing newline on each description must not produce a doubled blank
  // line between entries.
  expect(output).not.toContain('\n\n\n');
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
