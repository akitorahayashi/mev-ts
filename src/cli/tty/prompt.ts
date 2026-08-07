import { createInterface, type Interface } from 'node:readline/promises';

/** A line-oriented question source bound to an open readline session. */
export interface Prompter {
  /** Ask for a value, returning `fallback` when the answer is blank. */
  ask(label: string, fallback: string): Promise<string>;
}

/**
 * A prompter provider: runs `run` against an open prompter session. `withPrompter`
 * is the process-bound implementation; tests inject a scripted provider so an
 * interactive flow stays testable without a TTY, mirroring the `SelectEntries`
 * port for the toggle prompt.
 */
export type WithPrompter = <T>(
  run: (prompter: Prompter) => Promise<T>,
) => Promise<T>;

export const withPrompter: WithPrompter = async <T>(
  run: (prompter: Prompter) => Promise<T>,
): Promise<T> => {
  const rl: Interface = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const prompter: Prompter = {
    async ask(label, fallback) {
      const display =
        fallback === '' ? `${label}: ` : `${label} [${fallback}]: `;
      const answer = (await rl.question(display)).trim();
      return answer === '' ? fallback : answer;
    },
  };

  try {
    return await run(prompter);
  } finally {
    rl.close();
  }
};
