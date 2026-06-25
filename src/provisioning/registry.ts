import { CommandLineError } from '../errors';
import type { Target } from './target';
import { bunTarget } from './targets/bun';
import { coderTarget } from './targets/coder';
import { dutiTarget } from './targets/duti';
import { ghTarget } from './targets/gh';
import { ghosttyTarget } from './targets/ghostty';
import { gitTarget } from './targets/git';
import { nodejsTarget } from './targets/nodejs';
import { nvimTarget } from './targets/nvim';
import { pipxTarget } from './targets/pipx';
import { pnpmTarget } from './targets/pnpm';
import { pythonTarget } from './targets/python';
import { rubyTarget } from './targets/ruby';
import { shellTarget } from './targets/shell';
import { systemTarget } from './targets/system';

/** Every target mev can provision. Tags, aliases, and packages derive from here. */
const targets: readonly Target[] = [
  gitTarget,
  shellTarget,
  ghTarget,
  systemTarget,
  pythonTarget,
  pipxTarget,
  rubyTarget,
  nodejsTarget,
  pnpmTarget,
  bunTarget,
  nvimTarget,
  ghosttyTarget,
  coderTarget,
  dutiTarget,
];

/** Resolve a tag or alias to its owning target. */
export function resolveTarget(selector: string): Target {
  const match = targets.find(
    (t) => t.tags.includes(selector) || t.aliases.includes(selector),
  );
  if (!match) {
    throw new CommandLineError(
      `Unknown tag '${selector}'. Available: ${availableSelectors().join(', ')}.`,
    );
  }
  return match;
}

/** All selectable tags and aliases, in declaration order. */
export function availableSelectors(): string[] {
  return targets.flatMap((t) => [...t.tags, ...t.aliases]);
}

/** Every registered target, in declaration order. */
export function allTargets(): readonly Target[] {
  return targets;
}
