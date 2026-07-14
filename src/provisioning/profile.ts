import { CommandLineError } from '../errors';

interface ProfileEntry {
  readonly id: string;
  readonly aliases: readonly string[];
}

/** The authoritative profile table: canonical id plus input aliases. */
const PROFILES = [
  { id: 'macbook', aliases: ['mbk'] },
  { id: 'mac-mini', aliases: ['mmn'] },
] as const satisfies readonly ProfileEntry[];

/** A hardware profile a full-environment `create` targets, derived from the table. */
export type Profile = (typeof PROFILES)[number]['id'];

/** All selectable profile identifiers and aliases, in declaration order. */
export function availableProfiles(): string[] {
  return PROFILES.flatMap((p) => [p.id, ...p.aliases]);
}

/** Resolve a profile identifier or alias to its canonical `Profile`. */
export function resolveProfile(input: string): Profile {
  const match = PROFILES.find(
    (p) => p.id === input || p.aliases.some((alias) => alias === input),
  );
  if (!match) {
    throw new CommandLineError(
      `Unknown profile '${input}'. Available: ${availableProfiles().join(', ')}.`,
    );
  }
  return match.id;
}
