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
