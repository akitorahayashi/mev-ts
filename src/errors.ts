import { UsageError } from 'clipanion';

export { UsageError as CommandLineError };

export class AppError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AppError';
  }
}

export class ProvisioningError extends AppError {}
