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

const config = { key: 'demo/global/config' };

test('declared assets, packages, and activation destinations affect the signature', async () => {
  const original = target('demo', {
    description: 'original',
    role: 'demo',
    packages: { formulae: ['fd'] },
    activations: [link(config, home('.config/demo'))],
  });
  const moved = target('demo', {
    description: 'changed display text',
    aliases: ['d'],
    role: 'demo',
    packages: { formulae: ['fd', 'ripgrep'] },
    activations: [link(config, home('.config/demo/config'))],
  });

  const originalSignature = await targetSignature(
    original,
    assetSource({ [config.key]: 'one\n' }),
  );
  const changedAssetSignature = await targetSignature(
    original,
    assetSource({ [config.key]: 'two\n' }),
  );
  const movedSignature = await targetSignature(
    moved,
    assetSource({ [config.key]: 'one\n' }),
  );

  expect(changedAssetSignature).not.toBe(originalSignature);
  expect(movedSignature).not.toBe(originalSignature);
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

test('command implementation functions do not affect the signature', async () => {
  const first = target('demo', {
    description: 'first',
    role: 'demo',
    activations: [
      runCommand({
        label: 'demo command',
        reads: { version: 'demo/global/version' },
        steps: [{ argv: () => ['demo', 'slow'] }],
      }),
    ],
  });
  const optimized = target('demo', {
    description: 'optimized',
    role: 'demo',
    activations: [
      runCommand({
        label: 'demo command',
        reads: { version: 'demo/global/version' },
        steps: [
          {
            argv: () => ['demo', 'fast'],
            env: () => ({ DEMO_FAST: '1' }),
            changedWhen: 'never',
          },
        ],
      }),
    ],
  });
  const assets = assetSource({ 'demo/global/version': '1.0.0\n' });

  expect(await targetSignature(first, assets)).toBe(
    await targetSignature(optimized, assets),
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
          steps: [{ argv: () => ['demo'] }],
        }),
      ],
    });
  const assets = assetSource({
    'demo/global/version': '1\n',
    'demo/global/next-version': '2\n',
  });
  const original = await targetSignature(
    commandTarget('demo command', 'demo/global/version'),
    assets,
  );

  expect(
    await targetSignature(
      commandTarget('renamed command', 'demo/global/version'),
      assets,
    ),
  ).not.toBe(original);
  expect(
    await targetSignature(
      commandTarget('demo command', 'demo/global/next-version'),
      assets,
    ),
  ).not.toBe(original);
});
