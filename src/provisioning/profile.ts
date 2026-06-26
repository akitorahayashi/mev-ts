import { CommandLineError } from '../errors';

/** A hardware profile a full-environment `create` targets. */
export type Profile = 'macbook' | 'mac-mini';

interface ProfileEntry {
  readonly id: Profile;
  readonly aliases: readonly string[];
}

/** The authoritative profile table: canonical id plus input aliases. */
const PROFILES: readonly ProfileEntry[] = [
  { id: 'macbook', aliases: ['mbk'] },
  { id: 'mac-mini', aliases: ['mmn'] },
];

/** All selectable profile identifiers and aliases, in declaration order. */
export function availableProfiles(): string[] {
  return PROFILES.flatMap((p) => [p.id, ...p.aliases]);
}

/** Resolve a profile identifier or alias to its canonical `Profile`. */
export function resolveProfile(input: string): Profile {
  const match = PROFILES.find(
    (p) => p.id === input || p.aliases.includes(input),
  );
  if (!match) {
    throw new CommandLineError(
      `Unknown profile '${input}'. Available: ${availableProfiles().join(', ')}.`,
    );
  }
  return match.id;
}
