import { AppError } from '../../errors';

export class DocumentConversionError extends AppError {}

/** Passed to shared host primitives so their guards report this domain's class. */
export const documentConversionError = (message: string): Error =>
  new DocumentConversionError(message);
