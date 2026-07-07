import type { Command } from 'clipanion';

/**
 * Writes a namespace's subcommand listing to stdout: the invoked path as a
 * `<command>` header, then every registered command sharing `category` except
 * the namespace's own overview command at `canonicalPath`. Shared by the
 * namespace commands (`config`, `user`) whose bare form lists its subcommands
 * rather than performing an action, so `<namespace>` and `<namespace> --help`
 * both surface the same listing.
 */
export function writeNamespaceOverview(
  command: Command,
  category: string,
  canonicalPath: readonly string[],
): void {
  const canonical = `${command.cli.binaryName} ${canonicalPath.join(' ')}`;
  const invoked = `${command.cli.binaryName} ${command.path.join(' ')}`;
  const entries = command.cli
    .definitions()
    .filter(
      (definition) =>
        definition.category?.trim() === category &&
        definition.path !== canonical,
    );

  process.stdout.write(`${invoked} <command>\n\n`);
  for (const entry of entries) {
    process.stdout.write(`  ${entry.usage}\n`);
    if (entry.description) {
      process.stdout.write(`    ${entry.description}\n`);
    }
    process.stdout.write('\n');
  }
}
