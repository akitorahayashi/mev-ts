import { expect, test } from 'bun:test';
import {
  type CommandHelp,
  type RootHelp,
  renderCommandHelp,
  renderRootHelp,
} from '../../src/mev/cli/tty/help';

const rootHelp: RootHelp = {
  bin: 'mev',
  tagline: 'macOS development environment provisioning CLI',
  commands: [
    {
      invocation: 'make <tags...>',
      aliases: ['mk'],
      description: 'Apply provisioning for one or more tags.',
      options: [],
    },
    {
      invocation: 'user [scope]',
      aliases: ['us'],
      description: 'Manage Git identities (personal/p, work/w, set).',
      options: [],
    },
  ],
};

const makeCommand: CommandHelp = {
  invocation: 'make <tags...>',
  aliases: ['mk'],
  description: 'Apply provisioning for one or more tags.',
  options: [{ flags: '--plan', description: 'Show what would change.' }],
};

test('renderRootHelp lists every command once with its alias', () => {
  const output = renderRootHelp(rootHelp, false);
  expect(output).toContain('make <tags...>');
  expect(output).toContain('user [scope]');
  expect(output).toContain('mk');
  expect(output).toContain('us');
});

test('renderRootHelp does not repeat the command list', () => {
  const output = renderRootHelp(rootHelp, false);
  const occurrences = output.split('make <tags...>').length - 1;
  expect(occurrences).toBe(1);
});

test('renderRootHelp points to per-command help without re-listing commands', () => {
  const output = renderRootHelp(rootHelp, false);
  expect(output).toContain('mev <command> --help');
});

test('renderCommandHelp shows usage, declared options, and the help flag', () => {
  const output = renderCommandHelp('mev', makeCommand, false);
  expect(output).toContain('mev make <tags...>');
  expect(output).toContain('--plan');
  expect(output).toContain('-h, --help');
});

test('renderCommandHelp omits the Aliases section when none exist', () => {
  const output = renderCommandHelp(
    'mev',
    { ...makeCommand, aliases: [] },
    false,
  );
  expect(output).not.toContain('Aliases');
});

test('renderRootHelp emits no ANSI codes when isTTY is false', () => {
  expect(renderRootHelp(rootHelp, false)).not.toContain('\x1b[');
});

test('renderRootHelp emits ANSI codes when isTTY is true', () => {
  expect(renderRootHelp(rootHelp, true)).toContain('\x1b[');
});

test('renderCommandHelp emits ANSI codes when isTTY is true', () => {
  expect(renderCommandHelp('mev', makeCommand, true)).toContain('\x1b[');
});
