import type { CommandArg, CommandEnvValue, CommandStep } from './contract';

/**
 * The shared step that captures Homebrew's prefix into `brewPrefix` for later
 * steps to build a PATH from. Capturing it once keeps every toolchain step's PATH
 * consistent with the actual Homebrew prefix rather than a hardcoded location.
 */
export function brewPrefixCapture(): CommandStep {
  return {
    label: 'brew prefix',
    argv: ['brew', '--prefix'],
    capture: 'brewPrefix',
    changedWhen: 'never',
  };
}

/**
 * A PATH override that puts Homebrew's `bin` ahead of the inherited PATH, with
 * optional `leading` entries inserted between the two. Empty segments are dropped
 * so an absent inherited PATH does not leave a trailing separator. Requires a
 * prior `brewPrefixCapture()` step in the same pipeline.
 */
export function brewPath(leading: readonly CommandArg[] = []): {
  PATH: CommandEnvValue;
} {
  return {
    PATH: {
      pathList: [
        { concat: [{ ref: 'brewPrefix' }, '/bin'] },
        ...leading,
        { ref: 'basePath' },
      ],
    },
  };
}
