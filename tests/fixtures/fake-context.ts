import type { AssetSource } from '../../src/assets/registry';
import type { CommandOptions, CommandResult } from '../../src/host/command';
import type { Context } from '../../src/host/context';

/** An AssetSource that embeds nothing. */
export const emptyAssets: AssetSource = {
  async read() {
    return '';
  },
  keysByPrefix() {
    return [];
  },
  isExecutable() {
    return false;
  },
};

/** A command invocation recorded by a recording context. */
export interface Invocation {
  readonly command: string;
  readonly args: readonly string[];
  readonly options?: CommandOptions;
}

/** Decides the result for a recorded command invocation. */
export type Responder = (
  command: string,
  args: readonly string[],
  options?: CommandOptions,
) => CommandResult;

export interface RecordingContextOptions {
  readonly home: string;
  readonly assets?: AssetSource;
  readonly basePath?: string;
  readonly respond?: Responder;
}

const succeed: Responder = () => ({ code: 0, stdout: '', stderr: '' });

/**
 * Build a Context whose command runner records every invocation into `calls`
 * and answers with `respond` (a constant success when omitted). Assets default
 * to `emptyAssets`.
 */
export function recordingContext(options: RecordingContextOptions): {
  readonly context: Context;
  readonly calls: Invocation[];
} {
  const calls: Invocation[] = [];
  const respond = options.respond ?? succeed;
  const context: Context = {
    home: options.home,
    assets: options.assets ?? emptyAssets,
    basePath: options.basePath ?? '',
    commands: {
      async run(command, args, opts) {
        calls.push({ command, args: [...args], options: opts });
        return respond(command, args, opts);
      },
    },
  };
  return { context, calls };
}
