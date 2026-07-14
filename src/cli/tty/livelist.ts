import { Listr } from 'listr2';
import { AppError, errorMessage } from '../../errors';

export interface LiveItem {
  label: string;
  run: () => Promise<void>;
}

/**
 * Render `items` as a live task list. Item failures are isolated
 * (`exitOnError: false`, so one failure never aborts the others) and collected;
 * after rendering completes, a single aggregated `AppError` carrying every
 * failed label and message is thrown. That keeps one reporter — the caller's
 * `runReportingDomainErrors` wrapper — in charge of the exit code, and never
 * leaks a listr-wrapped error type the wrapper cannot classify.
 */
export async function renderLiveList(
  items: LiveItem[],
  options: { concurrent: boolean },
): Promise<void> {
  const failures: { label: string; message: string }[] = [];
  const listr = new Listr(
    items.map((item) => ({
      title: item.label,
      task: async () => {
        try {
          await item.run();
        } catch (error) {
          failures.push({ label: item.label, message: errorMessage(error) });
          throw error;
        }
      },
    })),
    {
      concurrent: options.concurrent,
      exitOnError: false,
      rendererOptions: { collapseErrors: false },
    },
  );

  await listr.run();

  if (failures.length > 0) {
    const detail = failures
      .map((failure) => `${failure.label}: ${failure.message}`)
      .join('\n');
    throw new AppError(
      `${failures.length} of ${items.length} tasks failed:\n${detail}`,
    );
  }
}
