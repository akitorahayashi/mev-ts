import { readFileSync } from 'node:fs';

export function packageVersion(packageJsonText) {
  const parsed = JSON.parse(packageJsonText);
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    typeof parsed.version !== 'string' ||
    parsed.version.length === 0
  ) {
    throw new Error('package.json must contain a non-empty string version.');
  }
  return parsed.version;
}

export function validateReleaseTag(refName, packageJsonText) {
  const expected = `v${packageVersion(packageJsonText)}`;
  if (refName !== expected) {
    throw new Error(
      `Release tag ${refName} does not match package version ${expected}.`,
    );
  }
  return expected;
}

if (import.meta.main) {
  try {
    const refName = process.env.GITHUB_REF_NAME;
    if (!refName) {
      throw new Error('GITHUB_REF_NAME is required.');
    }
    validateReleaseTag(refName, readFileSync('package.json', 'utf8'));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
