import { expect, test } from 'bun:test';
import { CONFIG_NAMESPACE, configSubcommandPaths } from './namespace';

test('a subcommand answers on every namespace-by-leaf quadrant', () => {
  const paths = configSubcommandPaths('ssh-host', 'sh');

  // Derived from the namespace pair rather than restated, so adding a namespace
  // abbreviation widens this expectation with the implementation.
  const expected = CONFIG_NAMESPACE.flatMap((namespace) => [
    [namespace, 'ssh-host'],
    [namespace, 'sh'],
  ]);
  expect(paths).toEqual(expected);
  expect(paths).toHaveLength(CONFIG_NAMESPACE.length * 2);
});

test('a leaf whose abbreviation equals its name still registers both spellings', () => {
  // clipanion tolerates the duplicate; collapsing it here would instead make the
  // quadrant count depend on the leaf, which the overview relies on.
  expect(configSubcommandPaths('zed', 'zed')).toEqual([
    ['config', 'zed'],
    ['config', 'zed'],
    ['cf', 'zed'],
    ['cf', 'zed'],
  ]);
});
