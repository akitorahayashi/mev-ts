import { AppError } from '../../errors';

export async function runReportingDomainErrors(
  stderr: NodeJS.WritableStream,
  // biome-ignore lint/suspicious/noConfusingVoidType: Clipanion command bodies return void when they do not set an exit code.
  body: () => Promise<number | void>,
  // biome-ignore lint/suspicious/noConfusingVoidType: The command boundary returns either an explicit exit code or no code.
): Promise<number | void> {
  try {
    return await body();
  } catch (error) {
    if (error instanceof AppError) {
      stderr.write(`${error.name}: ${error.message}\n`);
      return 1;
    }
    throw error;
  }
}
