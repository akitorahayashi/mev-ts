import { expect } from 'bun:test';
import { runSet } from '../../src/cli/commands/user';
import type { Prompter, WithPrompter } from '../../src/cli/tty/prompt';
import { allScopes } from '../../src/identity/scope';
import {
  type Identity,
  type IdentityState,
  identityFilePath,
  readState,
} from '../../src/identity/store';
import { sandboxedTest } from '../fixtures/temporary-directory';

const sandboxTest = sandboxedTest('user-set-');

/** A prompter that replays scripted answers in order, ignoring the process TTY. */
function scriptedPrompter(answers: readonly string[]): WithPrompter {
  let index = 0;
  const prompter: Prompter = {
    async ask() {
      const answer = answers[index] ?? '';
      index += 1;
      return answer;
    },
  };
  return (run) => run(prompter);
}

sandboxTest(
  'user set persists the identities collected by the prompter',
  async (home) => {
    // Independent oracle: derive both the scripted answers and the expected state
    // from allScopes, so the assertion never mirrors runSet's own ordering logic.
    const answers: string[] = [];
    const expected = Object.fromEntries(
      allScopes().map((scope) => {
        const identity: Identity = {
          name: `${scope} Name`,
          email: `${scope}@example.com`,
        };
        answers.push(identity.name, identity.email);
        return [scope, identity];
      }),
    ) as IdentityState;

    const written: string[] = [];
    await runSet(
      home,
      (message) => written.push(message),
      scriptedPrompter(answers),
    );

    expect(await readState(identityFilePath(home))).toEqual(expected);
    expect(written.join('')).toContain('Identity configuration saved to');
  },
);
