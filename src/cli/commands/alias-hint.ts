type CommandPaths = readonly (readonly string[])[];

/**
 * Append an `[aliases: ...]` hint to a command description, derived from its
 * non-canonical `paths` so the hint cannot drift from the actual routing.
 */
export function withAliasHint(
  description: string,
  paths: CommandPaths,
): string {
  const aliases = paths.slice(1).map((path) => path.join(' '));
  return aliases.length > 0
    ? `${description} [aliases: ${aliases.join(', ')}]`
    : description;
}
