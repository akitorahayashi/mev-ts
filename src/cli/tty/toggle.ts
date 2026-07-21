import checkbox from '@inquirer/checkbox';
import type { SelectEntries } from '../../app/config-selection';

interface CheckboxChoice {
  readonly name: string;
  readonly value: string;
  readonly checked: boolean;
}

/** The subset of the `@inquirer/checkbox` prompt this module drives. */
type CheckboxPrompt = (config: {
  message: string;
  choices: CheckboxChoice[];
}) => Promise<string[]>;

/**
 * Build a multi-select toggle over an injected prompt. Returns the names the
 * user chose to keep enabled, or `null` if the user cancelled (Escape /
 * Ctrl+C). The prompt is injectable so the cancellation mapping is testable
 * without a process-wide module mock.
 */
export function createToggle(prompt: CheckboxPrompt): SelectEntries {
  return async (message, catalog, enabled) => {
    const enabledSet = new Set(enabled);
    try {
      return await prompt({
        message,
        choices: catalog.map((name) => ({
          name,
          value: name,
          checked: enabledSet.has(name),
        })),
      });
    } catch (err) {
      if (err instanceof Error && err.name === 'ExitPromptError') {
        return null;
      }
      throw err;
    }
  };
}

export const toggle: SelectEntries = createToggle(
  checkbox as unknown as CheckboxPrompt,
);
