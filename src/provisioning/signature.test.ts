import { expect, test } from 'bun:test';
import { mapAssetSource } from '../../tests/fixtures/asset-source';
import { home } from '../host/path';
import { type Activation, link, runCommand } from './activation';
import { targetSignature } from './signature';
import { target } from './target';

const config = { key: 'demo/config' };
const report = {
  kind: 'apply',
  subject: 'demo resource',
  detail: 'applied',
} as const;

test('declared assets and activation destinations affect the signature', async () => {
  const original = target('demo', {
    description: 'original',
    role: 'demo',
    activations: [link(config, home('.config/demo'))],
  });
  const destinationChanged = target('demo', {
    description: 'original',
    role: 'demo',
    activations: [link(config, home('.config/demo/config'))],
  });
  const assets = mapAssetSource({ [config.key]: 'one\n' });

  const originalSignature = await targetSignature(original, assets);
  const changedAssetSignature = await targetSignature(
    original,
    mapAssetSource({ [config.key]: 'two\n' }),
  );
  const brewfileAddedSignature = await targetSignature(
    original,
    mapAssetSource({ [config.key]: 'one\n', 'demo/Brewfile': 'brew "fd"\n' }),
  );
  const destinationChangedSignature = await targetSignature(
    destinationChanged,
    assets,
  );

  expect(changedAssetSignature).not.toBe(originalSignature);
  expect(brewfileAddedSignature).not.toBe(originalSignature);
  expect(destinationChangedSignature).not.toBe(originalSignature);
});

test('target display metadata does not affect the signature', async () => {
  const left = target('demo', {
    description: 'left',
    aliases: ['l'],
    role: 'demo',
    activations: [],
  });
  const right = target('demo', {
    description: 'right',
    aliases: ['r'],
    role: 'demo',
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
          steps: [{ label: 'demo step', argv: ['demo', lastArg], report }],
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
            {
              label: 'demo step',
              argv: ['demo'],
              report,
              ...(env ? { env } : {}),
            },
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
              report,
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
          steps: [{ label: 'demo step', argv: ['demo'], report }],
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
          steps:
            step.capture === undefined
              ? [
                  {
                    label: step.label,
                    argv: ['demo'],
                    ...(step.changedWhen
                      ? { changedWhen: step.changedWhen }
                      : {}),
                  },
                ]
              : [
                  {
                    label: step.label,
                    argv: ['demo'],
                    capture: step.capture,
                    ...(step.changedWhen
                      ? { changedWhen: step.changedWhen }
                      : {}),
                  },
                ],
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

test('display report metadata does not affect the command signature', async () => {
  const commandTarget = (subject: string) =>
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
              report: { kind: 'apply', subject, detail: 'done' },
            },
          ],
        }),
      ],
    });
  const assets = mapAssetSource({});
  expect(await targetSignature(commandTarget('old'), assets)).toBe(
    await targetSignature(commandTarget('new'), assets),
  );
});

test('dictionary keys named report remain semantic command inputs', async () => {
  const signature = (value: string, dictionary: 'env' | 'reads') =>
    targetSignature(
      target('demo', {
        description: 'demo',
        role: 'demo',
        activations: [
          runCommand({
            label: 'demo',
            ...(dictionary === 'reads' ? { reads: { report: value } } : {}),
            steps: [
              {
                label: 'demo',
                argv: ['demo'],
                report,
                ...(dictionary === 'env' ? { env: { report: value } } : {}),
              },
            ],
          }),
        ],
      }),
      mapAssetSource({}),
    );

  for (const dictionary of ['env', 'reads'] as const) {
    expect(await signature('first', dictionary)).not.toBe(
      await signature('second', dictionary),
    );
  }
});

test('object construction order is ignored while argv and activation order remain semantic', async () => {
  const command = (
    env: Record<string, string>,
    argv = ['demo', 'first', 'second'],
  ) =>
    runCommand({
      label: 'demo',
      steps: [{ label: 'demo', argv, env, report }],
    });
  const signature = (activations: readonly Activation[]) =>
    targetSignature(
      target('demo', { description: 'demo', role: 'demo', activations }),
      mapAssetSource({}),
    );
  const original = command({ alpha: 'a', report: 'semantic' });
  expect(await signature([original])).toBe(
    await signature([command({ report: 'semantic', alpha: 'a' })]),
  );
  expect(await signature([original])).not.toBe(
    await signature([
      command({ alpha: 'a', report: 'semantic' }, ['demo', 'second', 'first']),
    ]),
  );
  const other = link(config, home('.demo'));
  expect(await signature([original, other])).not.toBe(
    await signature([other, original]),
  );
});
