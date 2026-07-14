import type { CommandResult, CommandRunner } from '../../src/host/command';

/** A single recorded invocation: the args plus the stdout/stderr disposition. */
export interface RecordedCall {
  readonly args: string[];
  readonly stdout?: 'pipe' | 'inherit';
  readonly stderr?: 'pipe' | 'inherit';
}

/**
 * A CommandRunner that answers with `responses` in order, appending each call
 * to `calls`. Once the queue is exhausted every further call succeeds silently.
 */
export function sequenceRunner(
  responses: readonly CommandResult[],
  calls: RecordedCall[],
): CommandRunner {
  let index = 0;
  return {
    async run(_command, args, options): Promise<CommandResult> {
      calls.push({
        args: [...args],
        stdout: options?.stdout,
        stderr: options?.stderr,
      });
      return responses[index++] ?? { code: 0, stdout: '', stderr: '' };
    },
  };
}

/** Captures the command name and args of the latest presetRunner call. */
export interface PresetSink {
  command?: string;
  args?: string[];
}

/**
 * A CommandRunner that answers every call with `preset`, recording the most
 * recent command name and args into `sink`.
 */
export function presetRunner(
  preset: CommandResult,
  sink: PresetSink = {},
): CommandRunner {
  return {
    async run(command, args): Promise<CommandResult> {
      sink.command = command;
      sink.args = [...args];
      return preset;
    },
  };
}
