import { expect, test } from 'bun:test';
import { embeddedAssets } from '../../src/assets/registry';
import { ProvisioningError } from '../../src/errors';
import { home } from '../../src/host/path';
import {
  coderAgents,
  groveConfig,
  releaseBinaries,
  runCommand,
} from '../../src/provisioning/activation';
import { validateEmbeddedAssets } from '../../src/provisioning/preflight';
import { target } from '../../src/provisioning/target';
import { mapAssetSource } from '../fixtures/asset-source';

test('embedded asset preflight accepts the shipped registry', async () => {
  await expect(validateEmbeddedAssets(embeddedAssets)).resolves.toBeUndefined();
});

test('embedded asset preflight rejects a command read with no such asset', async () => {
  const demo = target('demo', {
    description: 'demo',
    role: 'demo',
    activations: [
      runCommand({
        label: 'demo command',
        reads: { manifest: 'demo/manifest.json' },
        steps: [{ label: 'noop', argv: ['true'] }],
      }),
    ],
  });

  await expect(
    validateEmbeddedAssets(mapAssetSource({ 'demo/other.json': '{}' }), [demo]),
  ).rejects.toBeInstanceOf(ProvisioningError);
});

test('embedded asset preflight rejects a Grove repository without a URL', async () => {
  const demo = target('demo', {
    description: 'demo',
    role: 'demo',
    activations: [
      groveConfig({ key: 'demo/grove.toml' }, home('Desktop/grove.toml')),
    ],
  });

  await expect(
    validateEmbeddedAssets(
      mapAssetSource({
        'demo/grove.toml': '[repos.invalid]\npath = "invalid"\n',
      }),
      [demo],
    ),
  ).rejects.toBeInstanceOf(ProvisioningError);
});

test('embedded asset preflight rejects a coder catalog missing a section file', async () => {
  const demo = target('demo', {
    description: 'demo',
    role: 'demo',
    activations: [coderAgents('coder/agents-sections', [])],
  });

  await expect(
    validateEmbeddedAssets(
      mapAssetSource({
        'coder/agents-sections/catalog.yml': 'sections:\n  - communication\n',
      }),
      [demo],
    ),
  ).rejects.toBeInstanceOf(ProvisioningError);
});

const releaseDemo = target('demo', {
  description: 'demo',
  role: 'demo',
  activations: [releaseBinaries('demo/binaries.yml')],
});

const RELEASE_MANIFEST = `
binaries:
  - name: kpv
    repo: akitorahayashi/kpv
    tag: v0.6.0
`.trimStart();

test('embedded asset preflight accepts a release manifest', async () => {
  await expect(
    validateEmbeddedAssets(
      mapAssetSource({
        'demo/binaries.yml': `${RELEASE_MANIFEST}  - name: mx\n    repo: akitorahayashi/mx\n    tag: latest\n`,
      }),
      [releaseDemo],
    ),
  ).resolves.toBeUndefined();
});

test('embedded asset preflight rejects a malformed release manifest', async () => {
  await expect(
    validateEmbeddedAssets(
      mapAssetSource({
        'demo/binaries.yml': `${RELEASE_MANIFEST}  - name: mx\n    repo: notaslug\n    tag: v4.0.0\n`,
      }),
      [releaseDemo],
    ),
  ).rejects.toBeInstanceOf(ProvisioningError);
});

test('embedded asset preflight rejects an unlisted coder section file', async () => {
  const demo = target('demo', {
    description: 'demo',
    role: 'demo',
    activations: [coderAgents('coder/agents-sections', [])],
  });

  await expect(
    validateEmbeddedAssets(
      mapAssetSource({
        'coder/agents-sections/catalog.yml': 'sections:\n  - communication\n',
        'coder/agents-sections/communication.md': '## Communication\n',
        'coder/agents-sections/testing.md': '## Testing\n',
      }),
      [demo],
    ),
  ).rejects.toBeInstanceOf(ProvisioningError);
});
