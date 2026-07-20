import type { DefaultsEntry } from './manifest';

export function defaultsArg(
  type: DefaultsEntry['type'],
  value: boolean | number | string,
  home: string,
): string {
  if (type === 'bool') return value ? 'YES' : 'NO';
  return String(value).replaceAll('$HOME', home).replace(/^~/, home);
}

function readValue(stdout: string): string {
  return stdout.replace(/\r?\n$/, '');
}

export function defaultsValueMatches(
  type: DefaultsEntry['type'],
  expected: string,
  actualStdout: string,
): boolean {
  const actual = readValue(actualStdout);
  if (type === 'bool') {
    return actual.trim() === (expected === 'YES' ? '1' : '0');
  }
  if (type === 'int' || type === 'float') {
    const actualNumber = Number(actual.trim());
    const expectedNumber = Number(expected);
    return (
      Number.isFinite(actualNumber) &&
      Number.isFinite(expectedNumber) &&
      actualNumber === expectedNumber
    );
  }
  return actual === expected;
}

export function defaultsTypeMatches(
  expected: DefaultsEntry['type'],
  actualStdout: string,
): boolean {
  const actual = readValue(actualStdout).trim().toLowerCase();
  const type = actual.startsWith('type is ')
    ? actual.slice('type is '.length)
    : actual;
  if (expected === 'bool') return type === 'boolean' || type === 'bool';
  if (expected === 'int') return type === 'integer' || type === 'int';
  return type === expected;
}
