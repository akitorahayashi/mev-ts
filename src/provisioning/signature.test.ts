import { expect, test } from 'bun:test';
import { mapAssetSource } from '../../tests/fixtures/asset-source';
import { home } from '../host/path';
import { link, runCommand } from './activation';
import { targetSignature } from './signature';
import { target } from './target';

const config = { key: 'demo/config' };

/**
 * A change-detector over the serialization, not an independent authority: the
 * digest is produced by the implementation it guards, and the relational tests
 * below carry the behavioral contract. Its job is to fail when the canonicalizer
 * is rewritten in a way that changes the bytes while preserving ordering
 * behavior, which no relational assertion can catch.
 *
 * The inputs are synthetic and fixed here rather than a production target and
 * the embedded registry, so editing an asset two directories away no longer
 * breaks a unit test — which is what trained routine re-pinning of this digest.
 */
const GOLDEN_TARGET = target('golden', {
  description: 'golden',
  role: 'demo',
  packages: { taps: ['a/b'], formulae: ['git', 'gh'], casks: ['zed'] },
  activations: [
    link(config, home('.demo/config')),
    runCommand({
      label: 'demo command',
      reads: { version: 'demo/version' },
      steps: [
        {
          label: 'install',
          argv: ['install', { ref: 'version' }, { splitRef: 'version' }],
          env: { PATH: { pathList: [{ ref: 'home' }, { ref: 'basePath' }] } },
          skipIf: { pathExists: { concat: [{ ref: 'home' }, '/.demo'] } },
          changedWhen: { outputContains: 'installed' },
        },
      ],
    }),
  ],
});

const GOLDEN_ASSETS = mapAssetSource(
  { 'demo/config': 'config contents\n', 'demo/version': '1.2.3\n' },
  ['demo/version'],
);

test('the signature serialization matches its pinned digest', async () => {
  expect(await targetSignature(GOLDEN_TARGET, GOLDEN_ASSETS)).toBe(
    'sha256:8c82e5745084129edc755c125c326498effdd4e20c4e5b19880cb6d888496493',
  );
});

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
  const assets = mapAssetSource({ [config.key]: 'one\n' });

  const originalSignature = await targetSignature(original, assets);
  const changedAssetSignature = await targetSignature(
    original,
    mapAssetSource({ [config.key]: 'two\n' }),
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

  expect(await targetSignature(left, mapAssetSource({}))).toBe(
    await targetSignature(right, mapAssetSource({})),
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
  const assets = mapAssetSource({});

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
  const assets = mapAssetSource({});

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
  const assets = mapAssetSource({});

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
  const assets = mapAssetSource({
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
  const assets = mapAssetSource({});
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
