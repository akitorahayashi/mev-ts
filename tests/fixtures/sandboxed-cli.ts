import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { runCommandLine } from '../../src/main';
import { captureStreams } from './streams';

export interface CliResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * Run the CLI against a sandbox home with an empty PATH, capturing both streams
 * and restoring the environment afterwards. Owning the save/restore here keeps
 * every CLI test's env mutation balanced by construction: one that forgets to
 * restore would leak HOME into every test that follows it.
 */
export async function runCliInSandbox(
  args: readonly string[],
  sandbox?: string,
): Promise<CliResult> {
  const streams = captureStreams();
  const previous = { home: process.env['HOME'], path: process.env['PATH'] };
  if (sandbox !== undefined) {
    const bin = join(sandbox, 'bin');
    await mkdir(bin, { recursive: true });
    process.env['HOME'] = sandbox;
    process.env['PATH'] = bin;
  }
  try {
    const code = await runCommandLine([...args], {
      colorDepth: 1,
      stdout: streams.stdout as NodeJS.WriteStream,
      stderr: streams.stderr as NodeJS.WriteStream,
    });
    return { code, stdout: streams.stdoutText(), stderr: streams.stderrText() };
  } finally {
    restore('HOME', previous.home);
    restore('PATH', previous.path);
  }
}

function restore(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}
