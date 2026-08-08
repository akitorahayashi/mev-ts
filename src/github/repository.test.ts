import { expect, test } from 'bun:test';
import { remoteMatchesRepository, sshRemoteUrl } from './repository';

const XLSX = { owner: 'akitorahayashi', name: 'xlsx' };

test('sshRemoteUrl builds an SCP-style remote on the host alias', () => {
  expect(
    sshRemoteUrl('github-personal', { owner: 'owner', name: 'repo' }),
  ).toBe('git@github-personal:owner/repo.git');
});

test('remoteMatchesRepository ignores the host alias segment', () => {
  expect(remoteMatchesRepository(sshRemoteUrl('github.com', XLSX), XLSX)).toBe(
    true,
  );
  expect(remoteMatchesRepository(sshRemoteUrl('github-work', XLSX), XLSX)).toBe(
    true,
  );
});

test('remoteMatchesRepository rejects another owner or repository', () => {
  expect(
    remoteMatchesRepository('git@github.com:someone-else/xlsx.git', XLSX),
  ).toBe(false);
  expect(
    remoteMatchesRepository('git@github.com:akitorahayashi/other.git', XLSX),
  ).toBe(false);
});

for (const foreign of [
  undefined,
  'https://github.com/akitorahayashi/xlsx.git',
  'ssh://git@github.com/akitorahayashi/xlsx.git',
  'git@github.com:akitorahayashi/xlsx',
]) {
  test(`remoteMatchesRepository rejects ${JSON.stringify(foreign)}`, () => {
    expect(remoteMatchesRepository(foreign, XLSX)).toBe(false);
  });
}
