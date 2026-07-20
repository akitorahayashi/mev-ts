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
  options: { concurrency: number },
): Promise<void> {
  if (!Number.isInteger(options.concurrency) || options.concurrency <= 0) {
    throw new AppError('live-list concurrency must be a positive integer.');
  }
  const failures = new Array<{ label: string; message: string } | undefined>(
    items.length,
  );
  const listr = new Listr(
    items.map((item, index) => ({
      title: item.label,
      task: async () => {
        try {
          await item.run();
        } catch (error) {
          failures[index] = {
            label: item.label,
            message: errorMessage(error),
          };
          throw error;
        }
      },
    })),
    {
      concurrent: options.concurrency,
      exitOnError: false,
      rendererOptions: { collapseErrors: false },
    },
  );

  await listr.run();

  const failed = failures.filter((failure) => failure !== undefined);
  if (failed.length > 0) {
    const detail = failed
      .map((failure) => `${failure.label}: ${failure.message}`)
      .join('\n');
    throw new AppError(
      `${failed.length} of ${items.length} tasks failed:\n${detail}`,
    );
  }
}
