import { makeStyle } from './style';

/** A flag spec and its description, as shown under a command's Options. */
export interface OptionHelp {
  readonly flags: string;
  readonly description: string;
}

/** One command's help-relevant surface, decoupled from the cac command object. */
export interface CommandHelp {
  readonly invocation: string;
  readonly aliases: readonly string[];
  readonly description: string;
  readonly options: readonly OptionHelp[];
}

/** The program-level help: tagline plus every registered command. */
export interface RootHelp {
  readonly bin: string;
  readonly tagline: string;
  readonly commands: readonly CommandHelp[];
}

// Every command supports --help because the CLI layer handles it uniformly, so
// the line is rendered here rather than carried in each command's option list.
const helpOption: OptionHelp = {
  flags: '-h, --help',
  description: 'Display this message.',
};

function pad(text: string, width: number): string {
  return text + ' '.repeat(width - text.length);
}

/** Render the program overview: one colored command table, no duplicate footer. */
export function renderRootHelp(
  help: RootHelp,
  isTTY = process.stdout.isTTY ?? false,
): string {
  const c = makeStyle(isTTY);
  const invWidth = Math.max(
    ...help.commands.map((cmd) => cmd.invocation.length),
  );
  const aliasWidth = Math.max(
    ...help.commands.map((cmd) => cmd.aliases.join(', ').length),
  );

  const rows = help.commands.map((cmd) => {
    const alias = cmd.aliases.join(', ');
    return (
      `  ${c.cyan(pad(cmd.invocation, invWidth))}   ` +
      `${c.yellow(pad(alias, aliasWidth))}   ` +
      cmd.description
    );
  });

  return [
    `${c.bold(help.bin)} — ${help.tagline}`,
    '',
    c.bold('Usage'),
    `  ${help.bin} <command> [options]`,
    '',
    c.bold('Commands'),
    ...rows,
    '',
    c.dim(`Run \`${help.bin} <command> --help\` for details.`),
    '',
  ].join('\n');
}

/** Render a single command's usage, aliases, and options. */
export function renderCommandHelp(
  bin: string,
  command: CommandHelp,
  isTTY = process.stdout.isTTY ?? false,
): string {
  const c = makeStyle(isTTY);
  const options = [...command.options, helpOption];
  const flagWidth = Math.max(...options.map((o) => o.flags.length));

  const lines: string[] = [
    `${c.bold(bin)} ${c.cyan(command.invocation)}`,
    `  ${command.description}`,
  ];

  if (command.aliases.length > 0) {
    lines.push(
      '',
      c.bold('Aliases'),
      `  ${c.yellow(command.aliases.join(', '))}`,
    );
  }

  lines.push('', c.bold('Options'));
  for (const option of options) {
    lines.push(
      `  ${c.cyan(pad(option.flags, flagWidth))}   ${option.description}`,
    );
  }
  lines.push('');

  return lines.join('\n');
}
