import { expect, test } from 'bun:test';
import type { AssetSource } from '../assets/registry';
import { home } from '../host/path';
import { link, runCommand } from './activation';
import { targetSignature } from './signature';
import { target } from './target';

function assetSource(
  contents: Readonly<Record<string, string>> = {},
  executable: readonly string[] = [],
): AssetSource {
  const executableKeys = new Set(executable);
  return {
    async read(key) {
      const content = contents[key];
      if (content === undefined) throw new Error(`unknown asset ${key}`);
      return content;
    },
    keysByPrefix(prefix) {
      return Object.keys(contents)
        .filter((key) => key.startsWith(prefix))
        .sort();
    },
    isExecutable(key) {
      return executableKeys.has(key);
    },
  };
}

const config = { key: 'demo/config' };

test('declared assets, packages, and activation destinations affect the signature', async () => {
  const original = target('demo', {
    description: 'original',
    role: 'demo',
    packages: { formulae: ['fd'] },
    activations: [link(config, home('.config/demo'))],
  });
  const packageChanged = target('demo', {
    description: 'original',
    role: 'demo',
    packages: { formulae: ['fd', 'ripgrep'] },
    activations: [link(config, home('.config/demo'))],
  });
  const destinationChanged = target('demo', {
    description: 'original',
    role: 'demo',
    packages: { formulae: ['fd'] },
    activations: [link(config, home('.config/demo/config'))],
  });
  const assets = assetSource({ [config.key]: 'one\n' });

  const originalSignature = await targetSignature(original, assets);
  const changedAssetSignature = await targetSignature(
    original,
    assetSource({ [config.key]: 'two\n' }),
  );
  const packageChangedSignature = await targetSignature(packageChanged, assets);
  const destinationChangedSignature = await targetSignature(
    destinationChanged,
    assets,
  );

  expect(changedAssetSignature).not.toBe(originalSignature);
  expect(packageChangedSignature).not.toBe(originalSignature);
  expect(destinationChangedSignature).not.toBe(originalSignature);
});

test('package ordering and target display metadata do not affect the signature', async () => {
  const left = target('demo', {
    description: 'left',
    aliases: ['l'],
    role: 'demo',
    packages: { formulae: ['ripgrep', 'fd', 'fd'] },
    activations: [],
  });
  const right = target('demo', {
    description: 'right',
    aliases: ['r'],
    role: 'demo',
    packages: { formulae: ['fd', 'ripgrep'] },
    activations: [],
    optional: true,
  });

  expect(await targetSignature(left, assetSource())).toBe(
    await targetSignature(right, assetSource()),
  );
});

test('an argv edit flips the command signature', async () => {
  const commandTarget = (lastArg: string) =>
    target('demo', {
      description: 'demo',
      role: 'demo',
      activations: [
        runCommand({
          label: 'demo command',
          steps: [{ label: 'demo step', argv: ['demo', lastArg] }],
        }),
      ],
    });
  const assets = assetSource();

  expect(await targetSignature(commandTarget('fast'), assets)).not.toBe(
    await targetSignature(commandTarget('slow'), assets),
  );
});

test('an env edit flips the command signature', async () => {
  const commandTarget = (env?: Record<string, string>) =>
    target('demo', {
      description: 'demo',
      role: 'demo',
      activations: [
        runCommand({
          label: 'demo command',
          steps: [
            { label: 'demo step', argv: ['demo'], ...(env ? { env } : {}) },
          ],
        }),
      ],
    });
  const assets = assetSource();

  expect(
    await targetSignature(commandTarget({ DEMO_FAST: '1' }), assets),
  ).not.toBe(await targetSignature(commandTarget(), assets));
});

test('a skipIf edit flips the command signature', async () => {
  const commandTarget = (path: string) =>
    target('demo', {
      description: 'demo',
      role: 'demo',
      activations: [
        runCommand({
          label: 'demo command',
          steps: [
            {
              label: 'demo step',
              argv: ['demo'],
              skipIf: { pathExists: path },
            },
          ],
        }),
      ],
    });
  const assets = assetSource();

  expect(await targetSignature(commandTarget('/a'), assets)).not.toBe(
    await targetSignature(commandTarget('/b'), assets),
  );
});

test('command label and read declarations affect the signature', async () => {
  const commandTarget = (label: string, key: string) =>
    target('demo', {
      description: 'demo',
      role: 'demo',
      activations: [
        runCommand({
          label,
          reads: { version: key },
          steps: [{ label: 'demo step', argv: ['demo'] }],
        }),
      ],
    });
  const assets = assetSource({
    'demo/version': '1\n',
    'demo/next-version': '2\n',
  });
  const original = await targetSignature(
    commandTarget('demo command', 'demo/version'),
    assets,
  );

  expect(
    await targetSignature(
      commandTarget('renamed command', 'demo/version'),
      assets,
    ),
  ).not.toBe(original);
  expect(
    await targetSignature(
      commandTarget('demo command', 'demo/next-version'),
      assets,
    ),
  ).not.toBe(original);
});

test('serializable step metadata affects the signature', async () => {
  const commandTarget = (step: {
    readonly label: string;
    readonly capture?: string;
    readonly changedWhen?: 'always' | 'never';
  }) =>
    target('demo', {
      description: 'demo',
      role: 'demo',
      activations: [
        runCommand({
          label: 'demo command',
          steps: [{ ...step, argv: ['demo'] }],
        }),
      ],
    });
  const assets = assetSource();
  const original = await targetSignature(
    commandTarget({ label: 'demo step' }),
    assets,
  );

  expect(
    await targetSignature(commandTarget({ label: 'renamed step' }), assets),
  ).not.toBe(original);
  expect(
    await targetSignature(
      commandTarget({ label: 'demo step', capture: 'version' }),
      assets,
    ),
  ).not.toBe(original);
  expect(
    await targetSignature(
      commandTarget({ label: 'demo step', changedWhen: 'never' }),
      assets,
    ),
  ).not.toBe(original);
});
