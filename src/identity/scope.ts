/**
 * Git identity scopes mev switches between. Canonical names and their input
 * aliases derive from this single map so the CLI surface stays in sync.
 */
const scopeAliases = {
  personal: ['p'],
  work: ['w'],
} as const;

export type IdentityScope = keyof typeof scopeAliases;

/** Every scope, in declaration order. */
export function allScopes(): readonly IdentityScope[] {
  return Object.keys(scopeAliases) as IdentityScope[];
}

/** Input aliases for a scope, excluding its canonical name. */
export function aliasesOf(scope: IdentityScope): readonly string[] {
  return scopeAliases[scope];
}

/** Resolve a canonical name or alias to its scope, or null when unknown. */
export function resolveScope(input: string): IdentityScope | null {
  const lower = input.toLowerCase();
  return (
    allScopes().find(
      (scope) => scope === lower || aliasesOf(scope).includes(lower),
    ) ?? null
  );
}
