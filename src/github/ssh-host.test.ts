import { expect, test } from 'bun:test';
import { requireSshHost } from './ssh-host';

test('requireSshHost returns a safe alias unchanged', () => {
  expect(requireSshHost('github.com')).toBe('github.com');
  expect(requireSshHost('github-personal')).toBe('github-personal');
});

for (const unsafe of ['github.com/work', 'git@github.com', '-alias', '']) {
  test(`requireSshHost rejects ${JSON.stringify(unsafe)}`, () => {
    expect(() => requireSshHost(unsafe)).toThrow(/SSH host/);
  });
}
