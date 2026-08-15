import type { AssetSource } from '../../src/assets/registry';

export function mapAssetSource(
  contents: Readonly<Record<string, string>>,
  executables: readonly string[] = [],
): AssetSource {
  const executable = new Set(executables);
  return {
    async read(key) {
      const content = contents[key];
      if (content === undefined) throw new Error(`unknown asset ${key}`);
      return content;
    },
    keysByPrefix(prefix) {
      return Object.keys(contents)
        .filter((key) => key.startsWith(prefix))
        .sort();
    },
    isExecutable(key) {
      return executable.has(key);
    },
  };
}
