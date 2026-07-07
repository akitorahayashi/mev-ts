import { UsageError } from 'clipanion';

export { UsageError as CommandLineError };

export class AppError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class ProvisioningError extends AppError {}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
