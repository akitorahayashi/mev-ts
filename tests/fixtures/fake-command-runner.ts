import type { CommandResult, CommandRunner } from '../../src/host/command';

export function ok(stdout = '', stderr = ''): CommandResult {
  return { code: 0, stdout, stderr };
}

export function fail(stderr = ''): CommandResult {
  return { code: 1, stdout: '', stderr };
}

export interface RecordedCall {
  readonly command: string;
  readonly args: string[];
  readonly stdout?: 'pipe' | 'inherit';
  readonly stderr?: 'pipe' | 'inherit';
}

export function sequenceRunner(
  responses: readonly CommandResult[],
  calls: RecordedCall[],
): CommandRunner {
  let index = 0;
  return {
    async run(command, args, options): Promise<CommandResult> {
      calls.push({
        command,
        args: [...args],
        stdout: options?.stdout,
        stderr: options?.stderr,
      });
      const response = responses[index++];
      // Running past the script is a test that under-specified its fixture, not
      // a success: returning code 0 here would let it pass while exercising
      // nothing.
      if (!response) {
        throw new Error(
          `sequenceRunner exhausted its ${responses.length} scripted responses at call ${index}: ${command} ${args.join(' ')}`,
        );
      }
      return response;
    },
  };
}

export interface PresetSink {
  command?: string;
  args?: string[];
}

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
