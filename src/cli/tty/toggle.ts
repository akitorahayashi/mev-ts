import checkbox from '@inquirer/checkbox';
import type { SelectEntries } from '../../app/config-selection';

/**
 * Present an interactive multi-select and return the names the user chose to
 * keep enabled, or `null` if the user cancelled (Escape / Ctrl+C).
 */
export const toggle: SelectEntries = async (message, catalog, enabled) => {
  const enabledSet = new Set(enabled);
  try {
    return await checkbox({
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
