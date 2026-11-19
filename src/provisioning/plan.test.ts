import { expect, test } from 'bun:test';
import { mapAssetSource } from '../../tests/fixtures/asset-source';
import { CommandLineError, ProvisioningError } from '../errors';
import { planMake } from './plan';
import { allTargets, resolveTarget } from './registry';

// planMake resolves selectors through the registry, so its inputs are real
// selectors. Expected values are derived independently of planMake itself: the
// canonical/alias equivalence comes from resolveTarget (planMake's separately
// owned dependency), and package expectations are literals written against
// fake role manifests rather than the embedded ones. Targets are discovered
// dynamically so no specific target name or alias is hardcoded.

const noAssets = mapAssetSource({});

function anyAliasedTarget(): { name: string; role: string; alias: string } {
  const found = allTargets().find((t) => t.aliases.length > 0);
  if (!found) {
    throw new Error('precondition: expected at least one target with an alias');
  }
  const alias = found.aliases[0];
  if (alias === undefined) {
    throw new Error('precondition: aliased target exposes no alias');
  }
  return { name: found.name, role: found.role, alias };
}

test('collapses a target selected by both its name and an alias into one attributed group', async () => {
  const { name, alias } = anyAliasedTarget();
  expect(resolveTarget(name)).toBe(resolveTarget(alias));

  const plan = await planMake([name, alias], noAssets);

  expect(plan.targetNames).toEqual([name]);
  expect(plan.groups).toHaveLength(1);
  const [group] = plan.groups;
  expect(group?.name).toBe(name);
});

test('deduplicates regardless of whether the alias or the name is seen first', async () => {
  const { name, alias } = anyAliasedTarget();
  expect((await planMake([alias, name], noAssets)).targetNames).toEqual([name]);
  expect((await planMake([name, alias], noAssets)).targetNames).toEqual([name]);
});

test('deduplicates the role of a target selected twice', async () => {
  const { name, role, alias } = anyAliasedTarget();
  expect((await planMake([name, alias], noAssets)).roles).toEqual([role]);
});

test('keeps one group per distinct target, attributed and ordered by selection', async () => {
  const [first, second] = allTargets();
  if (!first || !second) {
    throw new Error('precondition: expected at least two registered targets');
  }

  const plan = await planMake([first.name, second.name], noAssets);

  expect(plan.groups.map((group) => group.name)).toEqual([
    first.name,
    second.name,
  ]);
  for (const group of plan.groups) {
    expect(group).toMatchObject(resolveTarget(group.name));
  }
});

test("resolves each target's packages from its role manifest and merges them first-seen", async () => {
  const [first, second, third] = allTargets();
  if (!first || !second || !third) {
    throw new Error('precondition: expected at least three registered targets');
  }
  const assets = mapAssetSource({
    [`${first.role}/brew.yml`]:
      'formulae:\n  - fd\n  - jq\nuninstall:\n  formulae:\n    - redis\n',
    [`${second.role}/brew.yml`]: 'formulae:\n  - jq\ncasks:\n  - zed\n',
  });

  const plan = await planMake([first.name, second.name, third.name], assets);

  const none = { formulae: [], casks: [] };
  expect(plan.groups.map((group) => group.packages)).toEqual([
    {
      install: { formulae: ['fd', 'jq'], casks: [] },
      uninstall: { formulae: ['redis'], casks: [] },
    },
    { install: { formulae: ['jq'], casks: ['zed'] }, uninstall: none },
    { install: none, uninstall: none },
  ]);
  expect(plan.packages).toEqual({
    install: { formulae: ['fd', 'jq'], casks: ['zed'] },
    uninstall: { formulae: ['redis'], casks: [] },
  });
});

test('surfaces a malformed role manifest as a ProvisioningError', async () => {
  const [first] = allTargets();
  if (!first) {
    throw new Error('precondition: expected a registered target');
  }
  const assets = mapAssetSource({
    [`${first.role}/brew.yml`]: 'formulae:\n  - fd --HEAD\n',
  });

  await expect(planMake([first.name], assets)).rejects.toThrow(
    ProvisioningError,
  );
});

test('refuses selected targets that install and uninstall the same package', async () => {
  const [first, second] = allTargets();
  if (!first || !second) {
    throw new Error('precondition: expected at least two registered targets');
  }
  const assets = mapAssetSource({
    [`${first.role}/brew.yml`]: 'casks:\n  - zed\n',
    [`${second.role}/brew.yml`]: 'uninstall:\n  casks:\n    - zed\n',
  });

  await expect(planMake([first.name, second.name], assets)).rejects.toThrow(
    ProvisioningError,
  );
});

test('surfaces an unknown selector as a CommandLineError', async () => {
  await expect(
    planMake(['definitely-not-a-registered-target'], noAssets),
  ).rejects.toThrow(CommandLineError);
});
