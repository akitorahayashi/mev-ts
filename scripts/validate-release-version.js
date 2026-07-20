import { readFileSync } from 'node:fs';
import { argv } from 'node:process';
import { pathToFileURL } from 'node:url';

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

// `import.meta.main` is undefined on Node before v20.19/v22.16/v24.2, which would
// skip this block and let the gate pass vacuously. Compare the entry path to this
// module URL instead so the guard holds on every supported Node version.
const invokedDirectly =
  argv[1] !== undefined && import.meta.url === pathToFileURL(argv[1]).href;

if (invokedDirectly) {
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
