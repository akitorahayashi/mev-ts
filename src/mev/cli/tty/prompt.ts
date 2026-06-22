import { createInterface, type Interface } from 'node:readline/promises';

/** A line-oriented question source bound to an open readline session. */
export interface Prompter {
  /** Ask for a value, returning `fallback` when the answer is blank. */
  ask(label: string, fallback: string): Promise<string>;
}

/**
 * Open a single readline session for the duration of `run`, exposing a
 * prompter, and guarantee the session is closed even if `run` throws.
 */
export async function withPrompter<T>(
  run: (prompter: Prompter) => Promise<T>,
): Promise<T> {
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
}
