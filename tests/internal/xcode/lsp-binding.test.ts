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

sandboxTest(
  'binds a workspace to Xcode build logs in preference to its project',
  async (directory) => {
    await mkdir(join(directory, 'App.xcworkspace'));
    await mkdir(join(directory, 'App.xcodeproj'));
    const calls: Call[] = [];

    await bindXcodeLsp(
      scriptedRunner([ok()], calls),
      { directory, scheme: 'App' },
      silent,
    );

    expect(calls).toEqual([
      {
        command: 'xcode-build-server',
        args: ['config', '-workspace', 'App.xcworkspace', '-scheme', 'App'],
        cwd: directory,
      },
    ]);
  },
);

sandboxTest(
  'binds a lone project and leaves the scheme to the latest build',
  async (directory) => {
    await mkdir(join(directory, 'App.xcodeproj'));
    const calls: Call[] = [];

    await bindXcodeLsp(scriptedRunner([ok()], calls), { directory }, silent);

    expect(calls).toEqual([
      {
        command: 'xcode-build-server',
        args: ['config', '-project', 'App.xcodeproj'],
        cwd: directory,
      },
    ]);
  },
);

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
  'builds a package for the iOS Simulator and parses the build log',
  async (directory) => {
    await writeFile(join(directory, 'Package.swift'), '');
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
  'requires --scheme when a package has several schemes',
  async (directory) => {
    await writeFile(join(directory, 'Package.swift'), '');
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
  'reports compiler errors and skips parsing when the package build fails',
  async (directory) => {
    await writeFile(join(directory, 'Package.swift'), '');
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
  await writeFile(join(directory, 'Package.swift'), '');

  await expect(
    bindXcodeLsp(
      scriptedRunner([ok('log'), fail('bad log')], []),
      { directory, scheme: 'App' },
      silent,
    ),
  ).rejects.toThrow('xcode-build-server parse failed');
});
