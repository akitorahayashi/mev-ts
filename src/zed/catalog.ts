import { readDeployedDirents } from '../host/deployed-file';

const JSON_SUFFIX = '.json';

export async function readOverrides(sourceDir: string): Promise<string[]> {
  const entries = await readDeployedDirents(
    sourceDir,
    'Zed overrides source directory',
  );
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(JSON_SUFFIX))
    .map((entry) => entry.name.slice(0, -JSON_SUFFIX.length))
    .sort();
}
