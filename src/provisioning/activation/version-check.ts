import type { CommandArg, CommandEnvValue, CommandStep } from './contract';

/**
 * A `<tool> --version` health-check step. It never counts as a change
 * (`changedWhen: 'never'`), so it verifies the tool is on PATH without making the
 * activation report a change on every run.
 */
export function versionCheckStep(
  label: string,
  tool: CommandArg,
  env?: Readonly<Record<string, CommandEnvValue>>,
): CommandStep {
  return {
    label,
    argv: [tool, '--version'],
    changedWhen: 'never',
    ...(env ? { env } : {}),
  };
}
