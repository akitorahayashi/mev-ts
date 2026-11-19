import { expect, test } from 'bun:test';
import { ProvisioningError } from '../errors';
import { mergePackages } from './package';

test('mergePackages dedupes each list first-seen', () => {
  expect(
    mergePackages([
      {
        install: { formulae: ['fd', 'jq'], casks: [] },
        uninstall: { formulae: ['redis'], casks: [] },
      },
      {
        install: { formulae: ['jq', 'bat'], casks: ['zed'] },
        uninstall: { formulae: ['redis'], casks: ['iina'] },
      },
    ]),
  ).toEqual({
    install: { formulae: ['fd', 'jq', 'bat'], casks: ['zed'] },
    uninstall: { formulae: ['redis'], casks: ['iina'] },
  });
});

test('mergePackages refuses a name one requirement installs and another uninstalls', () => {
  expect(() =>
    mergePackages([
      {
        install: { formulae: [], casks: ['zed'] },
        uninstall: { formulae: [], casks: [] },
      },
      {
        install: { formulae: [], casks: [] },
        uninstall: { formulae: [], casks: ['zed'] },
      },
    ]),
  ).toThrow(
    new ProvisioningError(
      "Homebrew cask 'zed' is declared for both install and uninstall.",
    ),
  );
});

test('mergePackages allows uninstalling a cask whose name a formula installs', () => {
  expect(
    mergePackages([
      {
        install: { formulae: ['docker'], casks: [] },
        uninstall: { formulae: [], casks: ['docker'] },
      },
    ]),
  ).toEqual({
    install: { formulae: ['docker'], casks: [] },
    uninstall: { formulae: [], casks: ['docker'] },
  });
});
