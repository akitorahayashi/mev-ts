import type { CommandResult, CommandRunner } from '../../src/host/command';

export function ok(stdout = '', stderr = ''): CommandResult {
  return { code: 0, stdout, stderr };
}

export function fail(stderr = ''): CommandResult {
  return { code: 1, stdout: '', stderr };
}

export interface RecordedCall {
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
