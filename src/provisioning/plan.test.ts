import { expect, test } from 'bun:test';
import { CommandLineError } from '../errors';
import { planMake } from './plan';
import { allTargets, resolveTarget } from './registry';

// planMake resolves selectors through the registry, so its inputs are real
// selectors. Expected values are derived independently of planMake itself: the
// canonical/alias equivalence comes from resolveTarget (planMake's separately
// owned dependency), and the merge oracle below is a hand-rolled first-seen
// union rather than the production merge that planMake calls. An aliased target
// is discovered dynamically so no specific target name or alias is hardcoded.

function firstSeenUnion(lists: readonly (readonly string[])[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const list of lists) {
    for (const value of list) {
      if (!seen.has(value)) {
        seen.add(value);
        out.push(value);
      }
    }
  }
  return out;
}

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

test('collapses a target selected by both its name and an alias into one attributed group', () => {
  const { name, alias } = anyAliasedTarget();
  expect(resolveTarget(name)).toBe(resolveTarget(alias));

  const plan = planMake([name, alias]);

  expect(plan.targetNames).toEqual([name]);
  expect(plan.groups).toHaveLength(1);
  const [group] = plan.groups;
  expect(group?.targetName).toBe(name);
});

test('deduplicates regardless of whether the alias or the name is seen first', () => {
  const { name, alias } = anyAliasedTarget();
  expect(planMake([alias, name]).targetNames).toEqual([name]);
  expect(planMake([name, alias]).targetNames).toEqual([name]);
});

test('deduplicates the role of a target selected twice', () => {
  const { name, role, alias } = anyAliasedTarget();
  expect(planMake([name, alias]).roles).toEqual([role]);
});

test('keeps one group per distinct target, attributed and ordered by selection', () => {
  const targets = allTargets();
  const [first, second] = targets;
  if (!first || !second) {
    throw new Error('precondition: expected at least two registered targets');
  }

  const plan = planMake([first.name, second.name]);

  expect(plan.groups.map((group) => group.targetName)).toEqual([
    first.name,
    second.name,
  ]);
  for (const group of plan.groups) {
    const source = resolveTarget(group.targetName);
    expect(group.role).toBe(source.role);
    expect(group.packages).toBe(source.packages);
    expect(group.activations).toBe(source.activations);
  }
});

test('exposes a first-seen deduplicated package union across all distinct targets', () => {
  const targets = allTargets();
  const plan = planMake(targets.map((t) => t.name));

  expect(plan.targetNames).toEqual(targets.map((t) => t.name));
  expect(plan.packages.taps).toEqual(
    firstSeenUnion(targets.map((t) => t.packages.taps)),
  );
  expect(plan.packages.formulae).toEqual(
    firstSeenUnion(targets.map((t) => t.packages.formulae)),
  );
  expect(plan.packages.casks).toEqual(
    firstSeenUnion(targets.map((t) => t.packages.casks)),
  );
});

test('surfaces an unknown selector as a CommandLineError', () => {
  expect(() => planMake(['definitely-not-a-registered-target'])).toThrow(
    CommandLineError,
  );
});
