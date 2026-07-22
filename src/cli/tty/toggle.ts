import checkbox from '@inquirer/checkbox';
import type { SelectEntries } from '../../app/config-toggle';

/**
 * The prompt this module drives, derived from the `@inquirer/checkbox` default
 * export so a change to its config shape is a compile error here rather than a
 * runtime surprise on the interactive path CI cannot exercise.
 */
type CheckboxPrompt = typeof checkbox;

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

export const toggle: SelectEntries = createToggle(checkbox);
