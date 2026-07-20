import { expect, test } from 'bun:test';
import { type AssetSource, embeddedAssets } from '../../src/assets/registry';
import { ProvisioningError } from '../../src/errors';
import { runCommand } from '../../src/provisioning/activation';
import { validateEmbeddedAssets } from '../../src/provisioning/preflight';
import { target } from '../../src/provisioning/target';

function assets(contents: Readonly<Record<string, string>>): AssetSource {
  return {
    async read(key) {
      const content = contents[key];
      if (content === undefined) throw new Error(`unknown asset ${key}`);
      return content;
    },
    keysByPrefix(prefix) {
      return Object.keys(contents).filter((key) => key.startsWith(prefix));
    },
    isExecutable() {
      return false;
    },
  };
}

test('embedded asset preflight accepts the shipped registry', async () => {
  await expect(validateEmbeddedAssets(embeddedAssets)).resolves.toBeUndefined();
});

test('embedded asset preflight invokes command read validators', async () => {
  const demo = target('demo', {
    description: 'demo',
    role: 'demo',
    activations: [
      runCommand({
        label: 'demo command',
        intentVersion: 1,
        reads: {
          manifest: {
            key: 'demo/manifest.json',
            validate: (raw) => JSON.parse(raw),
          },
        },
        steps: [{ label: 'noop', argv: () => ['true'] }],
      }),
    ],
  });

  await expect(
    validateEmbeddedAssets(assets({ 'demo/manifest.json': '{' }), [demo]),
  ).rejects.toBeInstanceOf(ProvisioningError);
});
