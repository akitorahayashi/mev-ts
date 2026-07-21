import { expect, test } from 'bun:test';
import { assetSourceHash } from '../../scripts/asset-registry';

const base = [{ key: 'a', content: 'x', executable: false }];

test('assetSourceHash is stable for identical input', () => {
  expect(assetSourceHash(base)).toBe(
    assetSourceHash([{ key: 'a', content: 'x', executable: false }]),
  );
});

test('assetSourceHash changes when a content byte changes', () => {
  expect(assetSourceHash(base)).not.toBe(
    assetSourceHash([{ key: 'a', content: 'y', executable: false }]),
  );
});

test('assetSourceHash changes when the executable bit changes', () => {
  expect(assetSourceHash(base)).not.toBe(
    assetSourceHash([{ key: 'a', content: 'x', executable: true }]),
  );
});

test('assetSourceHash changes when a key is added', () => {
  expect(assetSourceHash(base)).not.toBe(
    assetSourceHash([...base, { key: 'b', content: 'z', executable: false }]),
  );
});
