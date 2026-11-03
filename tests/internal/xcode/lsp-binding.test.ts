import { expect } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CommandLineError } from '../../../src/errors';
import type { CommandResult, CommandRunner } from '../../../src/host/command';
import {
  bindXcodeLsp,
  XcodeLspBindingError,
} from '../../../src/internal/xcode/lsp-binding';
import { fail, ok } from '../../fixtures/fake-command-runner';
import { sandboxedTest } from '../../fixtures/temporary-directory';

const sandboxTest = sandboxedTest('xcode-lsp-');

interface Call {
  readonly command: string;
  readonly args: string[];
  readonly cwd?: string;
  readonly parsedLog?: string;
  readonly parsedLogPath?: string;
}

function scriptedRunner(
  responses: readonly CommandResult[],
  calls: Call[],
): CommandRunner {
  let index = 0;
  return {
    async run(command, args, options): Promise<CommandResult> {
      const parse = command === 'xcode-build-server' && args[0] === 'parse';
      const logPath = parse ? args[1] : undefined;
      calls.push({
        command,
        args: [...args],
        cwd: options?.cwd,
        ...(logPath === undefined
          ? {}
          : {
              parsedLog: await readFile(logPath, 'utf8'),
              parsedLogPath: logPath,
            }),
      });
      const response = responses[index++];
      if (!response) throw new Error(`unscripted call: ${command}`);
      return response;
    },
  };
}

const silent = () => {};

const PLAYGROUND_MANIFEST =
  'import PackageDescription\nimport AppleProductTypes\n';
const PLAIN_MANIFEST = 'import PackageDescription\n';

const sweetpadWrote = (path: string): CommandResult =>
  ok(JSON.stringify({ schema: 1, ok: true, data: { buildServerJson: path } }));

sandboxTest(
  'binds a workspace through sweetpad in preference to its project',
  async (directory) => {
    await mkdir(join(directory, 'App.xcworkspace'));
    await mkdir(join(directory, 'App.xcodeproj'));
    const calls: Call[] = [];
    const messages: string[] = [];

    await bindXcodeLsp(
      scriptedRunner([sweetpadWrote('buildServer.json')], calls),
      { directory },
      (message) => messages.push(message),
    );

    expect(calls).toEqual([
      {
        command: 'sweetpad',
        args: [
          '--json',
          '--non-interactive',
          'bsp',
          'init',
          '--workspace',
          'App.xcworkspace',
        ],
        cwd: directory,
      },
    ]);
    expect(messages.join('')).toContain(join(directory, 'buildServer.json'));
  },
);

sandboxTest('binds a lone project through sweetpad', async (directory) => {
  await mkdir(join(directory, 'App.xcodeproj'));
  const calls: Call[] = [];

  await bindXcodeLsp(
    scriptedRunner([sweetpadWrote(join(directory, 'buildServer.json'))], calls),
    { directory },
    silent,
  );

  expect(calls).toEqual([
    {
      command: 'sweetpad',
      args: [
        '--json',
        '--non-interactive',
        'bsp',
        'init',
        '--project',
        'App.xcodeproj',
      ],
      cwd: directory,
    },
  ]);
});

for (const [layout, prepare] of [
  [
    'an Xcode project',
    (directory: string) => mkdir(join(directory, 'App.xcodeproj')),
  ],
  [
    'a plain package',
    (directory: string) =>
      writeFile(join(directory, 'Package.swift'), PLAIN_MANIFEST),
  ],
] as const) {
  sandboxTest(
    `rejects --scheme for ${layout} before running anything`,
    async (directory) => {
      await prepare(directory);
      const calls: Call[] = [];

      await expect(
        bindXcodeLsp(
          scriptedRunner([], calls),
          { directory, scheme: 'App' },
          silent,
        ),
      ).rejects.toBeInstanceOf(CommandLineError);
      expect(calls).toHaveLength(0);
    },
  );
}

sandboxTest(
  'names the target that installs sweetpad when it is missing',
  async (directory) => {
    await mkdir(join(directory, 'App.xcodeproj'));

    await expect(
      bindXcodeLsp(
        scriptedRunner(
          [{ code: 127, stdout: '', stderr: 'spawn sweetpad ENOENT' }],
          [],
        ),
        { directory },
        silent,
      ),
    ).rejects.toThrow('mev make sp');
  },
);

sandboxTest(
  'rejects a sweetpad envelope that reports failure',
  async (directory) => {
    await mkdir(join(directory, 'App.xcodeproj'));

    await expect(
      bindXcodeLsp(
        scriptedRunner([ok(JSON.stringify({ schema: 1, ok: false }))], []),
        { directory },
        silent,
      ),
    ).rejects.toBeInstanceOf(XcodeLspBindingError);
  },
);

sandboxTest('surfaces a failed sweetpad run', async (directory) => {
  await mkdir(join(directory, 'App.xcodeproj'));

  await expect(
    bindXcodeLsp(
      scriptedRunner([fail('no such project')], []),
      { directory },
      silent,
    ),
  ).rejects.toThrow('sweetpad bsp init failed');
});

sandboxTest('rejects multiple workspaces', async (directory) => {
  await mkdir(join(directory, 'A.xcworkspace'));
  await mkdir(join(directory, 'B.xcworkspace'));

  await expect(
    bindXcodeLsp(scriptedRunner([], []), { directory }, silent),
  ).rejects.toBeInstanceOf(XcodeLspBindingError);
});

sandboxTest('rejects a directory without a project', async (directory) => {
  await expect(
    bindXcodeLsp(scriptedRunner([], []), { directory }, silent),
  ).rejects.toBeInstanceOf(XcodeLspBindingError);
});

sandboxTest(
  'leaves a plain package to sourcekit-lsp and removes a stale binding',
  async (directory) => {
    await writeFile(join(directory, 'Package.swift'), PLAIN_MANIFEST);
    await writeFile(join(directory, 'buildServer.json'), '{}');
    await writeFile(join(directory, '.compile'), '[]');
    const calls: Call[] = [];

    await bindXcodeLsp(scriptedRunner([], calls), { directory }, silent);

    expect(calls).toHaveLength(0);
    expect(existsSync(join(directory, 'buildServer.json'))).toBe(false);
    expect(existsSync(join(directory, '.compile'))).toBe(false);
  },
);

sandboxTest('leaves an unbound plain package untouched', async (directory) => {
  await writeFile(join(directory, 'Package.swift'), PLAIN_MANIFEST);
  const calls: Call[] = [];

  await bindXcodeLsp(scriptedRunner([], calls), { directory }, silent);

  expect(calls).toHaveLength(0);
  expect(existsSync(join(directory, 'buildServer.json'))).toBe(false);
});

sandboxTest(
  'builds a Playgrounds package for the iOS Simulator and parses the build log',
  async (directory) => {
    await writeFile(join(directory, 'Package.swift'), PLAYGROUND_MANIFEST);
    const calls: Call[] = [];
    const listing = JSON.stringify({
      workspace: { name: 'App', schemes: ['App'] },
    });

    await bindXcodeLsp(
      scriptedRunner([ok(listing), ok('swiftc -module-name App'), ok()], calls),
      { directory },
      silent,
    );

    expect(calls.map(({ parsedLogPath: _, ...call }) => call)).toEqual([
      { command: 'xcodebuild', args: ['-list', '-json'], cwd: directory },
      {
        command: 'xcodebuild',
        args: [
          '-scheme',
          'App',
          '-destination',
          'generic/platform=iOS Simulator',
          'build',
        ],
        cwd: directory,
      },
      {
        command: 'xcode-build-server',
        args: ['parse', expect.any(String)],
        cwd: directory,
        parsedLog: 'swiftc -module-name App',
      },
    ]);
    const logPath = calls[2]?.parsedLogPath ?? '';
    expect(logPath).not.toBe('');
    expect(existsSync(logPath)).toBe(false);
  },
);

sandboxTest(
  'requires --scheme when a Playgrounds package has several schemes',
  async (directory) => {
    await writeFile(join(directory, 'Package.swift'), PLAYGROUND_MANIFEST);
    const calls: Call[] = [];
    const listing = JSON.stringify({
      workspace: { name: 'App', schemes: ['App', 'AppTests'] },
    });

    await expect(
      bindXcodeLsp(scriptedRunner([ok(listing)], calls), { directory }, silent),
    ).rejects.toBeInstanceOf(CommandLineError);
    expect(calls).toHaveLength(1);
  },
);

sandboxTest(
  'reports compiler errors and skips parsing when the Playgrounds build fails',
  async (directory) => {
    await writeFile(join(directory, 'Package.swift'), PLAYGROUND_MANIFEST);
    const calls: Call[] = [];

    const binding = bindXcodeLsp(
      scriptedRunner(
        [
          {
            code: 65,
            stdout: 'CompileSwift\nView.swift:3:1: error: cannot find X\n',
            stderr: '',
          },
        ],
        calls,
      ),
      { directory, scheme: 'App' },
      silent,
    );

    await expect(binding).rejects.toThrow('error: cannot find X');
    expect(calls.map((call) => call.command)).toEqual(['xcodebuild']);
  },
);

sandboxTest('surfaces a failed parse as a binding error', async (directory) => {
  await writeFile(join(directory, 'Package.swift'), PLAYGROUND_MANIFEST);

  await expect(
    bindXcodeLsp(
      scriptedRunner([ok('log'), fail('bad log')], []),
      { directory, scheme: 'App' },
      silent,
    ),
  ).rejects.toThrow('xcode-build-server parse failed');
});
