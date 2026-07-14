/** The subset of a clipanion command definition this renderer reads. */
export interface CommandDefinition {
  readonly path: string;
  readonly usage: string;
  readonly category?: string | null;
  readonly description?: string | null;
}

export interface NamespaceOverview {
  readonly binaryName: string;
  /** The path actually typed (e.g. `['cf']`), shown in the header. */
  readonly invokedPath: readonly string[];
  /** The namespace's own bare path (e.g. `['config']`), excluded from the list. */
  readonly canonicalPath: readonly string[];
  readonly category: string;
  readonly definitions: readonly CommandDefinition[];
}

/**
 * Render a namespace's subcommand listing: the invoked path as a `<command>`
 * header, then every command sharing `category` except the namespace's own
 * overview. The overview is matched by comparing path tokens (not a
 * reconstructed display string), so a formatting change in `definitions()`
 * cannot silently drop the exclusion.
 */
export function renderNamespaceOverview(overview: NamespaceOverview): string {
  const canonicalTokens = [overview.binaryName, ...overview.canonicalPath];
  const invoked = [overview.binaryName, ...overview.invokedPath].join(' ');
  const entries = overview.definitions.filter(
    (definition) =>
      definition.category?.trim() === overview.category &&
      !samePath(definition.path, canonicalTokens),
  );

  let output = `${invoked} <command>\n\n`;
  for (const entry of entries) {
    output += `  ${entry.usage}\n`;
    if (entry.description) {
      output += `    ${entry.description}\n`;
    }
    output += '\n';
  }
  return output;
}

function samePath(path: string, tokens: readonly string[]): boolean {
  const parts = path.split(' ');
  return (
    parts.length === tokens.length &&
    parts.every((part, index) => part === tokens[index])
  );
}
