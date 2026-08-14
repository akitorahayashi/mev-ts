import {
  applyEdits,
  modify,
  type ParseError,
  parse,
  printParseErrorCode,
} from 'jsonc-parser';
import { ProvisioningError } from '../errors';
import { isRecord } from './parse';

/**
 * JSON with Comments, the format VS Code-family editors use for their own
 * config files: `//` and block comments and trailing commas are valid there,
 * so parsing those files as strict JSON would fail on ordinary user state.
 */

/** Parse a JSONC document that must be an object at the top level. */
export function loadJsoncObject(
  raw: string,
  source: string,
): Record<string, unknown> {
  const errors: ParseError[] = [];
  const value: unknown = parse(raw, errors, { allowTrailingComma: true });
  const first = errors[0];
  if (first !== undefined) {
    throw new ProvisioningError(
      `${source} is not valid JSONC: ${printParseErrorCode(first.error)} at offset ${first.offset}.`,
    );
  }
  if (!isRecord(value)) {
    throw new ProvisioningError(
      `${source} must be a JSON object, not an array or primitive.`,
    );
  }
  return value;
}

/**
 * Apply per-path value assignments onto the document's original text, so
 * everything the assignments do not name — comments included — survives
 * verbatim rather than being lost to a whole-document reserialization.
 */
export function editJsoncObject(
  raw: string,
  assignments: readonly (readonly [readonly string[], unknown])[],
): string {
  let text = raw;
  for (const [path, value] of assignments) {
    text = applyEdits(
      text,
      modify(text, [...path], value, {
        formattingOptions: { insertSpaces: true, tabSize: 2 },
      }),
    );
  }
  return text;
}
