import { expect, test } from 'bun:test';
import { ProvisioningError } from '../errors';
import { loadToml } from '../host/toml';
import { renderConfig } from './config';

const CONFIG = `version = 2

[repos]
string = "git@github.com:owner/string.git"
https = "https://github.com/owner/public.git"
other = "git@gitlab.example:owner/other.git"
table = { url = "git@github.com:owner/table.git", default_branch = "trunk" }

[groups.Skills]
grouped = "git@github.com:owner/grouped.git"

[removed.repos]
old = { url = "git@github.com:owner/old.git" }

[removed.groups.Skills]
moved = { url = "git@github.com:owner/moved.git", moved_to = "grouped" }
`;

function render(config: string, host: string): Record<string, unknown> {
  return loadToml(renderConfig(config, host, 'grove.toml'), 'rendered');
}

test('renders stock GitHub SSH remotes in every repository position', () => {
  expect(render(CONFIG, 'github-work')).toEqual({
    version: 2,
    repos: {
      string: 'git@github-work:owner/string.git',
      https: 'https://github.com/owner/public.git',
      other: 'git@gitlab.example:owner/other.git',
      table: {
        url: 'git@github-work:owner/table.git',
        default_branch: 'trunk',
      },
    },
    groups: { Skills: { grouped: 'git@github-work:owner/grouped.git' } },
    removed: {
      repos: { old: { url: 'git@github-work:owner/old.git' } },
      groups: {
        Skills: {
          moved: {
            url: 'git@github-work:owner/moved.git',
            moved_to: 'grouped',
          },
        },
      },
    },
  });
});

test('keeps stock GitHub SSH remotes when the default host is selected', () => {
  expect(render(CONFIG, 'github.com')).toEqual(loadToml(CONFIG, 'expected'));
});

test.each([
  ['a version other than 2', 'version = 1\n'],
  ['a missing version', '[repos]\nx = "git@github.com:o/x.git"\n'],
  ['a table without a URL', 'version = 2\n[repos.x]\npath = "x"\n'],
  ['a non-string URL', 'version = 2\n[groups.G]\nx = 1\n'],
  [
    'a removed table without a URL',
    'version = 2\n[removed.repos.x]\nmoved_to = "y"\n',
  ],
])('rejects %s', (_case, config) => {
  expect(() => renderConfig(config, 'github.com', 'grove.toml')).toThrow(
    ProvisioningError,
  );
});
