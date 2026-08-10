import type { AssetSource } from '../../src/assets/registry';
import type { CommandOptions, CommandResult } from '../../src/host/command';
import type { Context } from '../../src/host/context';

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

export interface Invocation {
  readonly command: string;
  readonly args: readonly string[];
  readonly options?: CommandOptions;
}

/**
 * Decides the result for a recorded command invocation. May be async and may
 * perform side effects (for example writing a downloaded file), so tests no
 * longer rebuild a bespoke Context just to await inside the runner.
 */
export type Responder = (
  command: string,
  args: readonly string[],
  options?: CommandOptions,
) => CommandResult | Promise<CommandResult>;

export interface RecordingContextOptions {
  readonly home: string;
  readonly assets?: AssetSource;
  readonly basePath?: string;
  readonly respond?: Responder;
  readonly tmpRoot?: string;
}

const succeed: Responder = () => ({ code: 0, stdout: '', stderr: '' });

export function respondByCommand(
  handlers: Readonly<Record<string, Responder>>,
  fallback: Responder = succeed,
): Responder {
  return (command, args, options) =>
    (handlers[command] ?? fallback)(command, args, options);
}

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
    // Defaults to the sandbox home, not the real system temp root: a fixture
    // that invited scratch files into $TMPDIR is how tests started leaking
    // outside their sandbox.
    tmpRoot: options.tmpRoot ?? options.home,
    commands: {
      async run(command, args, opts) {
        calls.push({ command, args: [...args], options: opts });
        return respond(command, args, opts);
      },
    },
  };
  return { context, calls };
}
