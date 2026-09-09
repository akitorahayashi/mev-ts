import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { ProvisioningError } from '../errors';
import type { ErrorFactory } from './parse';

const provisioningError: ErrorFactory = (message) =>
  new ProvisioningError(message);

export function parseSha256Document(
  raw: string,
  label: string,
  raise: ErrorFactory = provisioningError,
): string {
  const [hash] = raw.trim().split(/\s+/);
  if (!hash || !/^[a-fA-F0-9]{64}$/.test(hash)) {
    throw raise(`Invalid SHA256 checksum document for ${label}.`);
  }
  return hash.toLowerCase();
}

export async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}
