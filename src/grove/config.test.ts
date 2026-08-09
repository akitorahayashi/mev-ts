import { expect, test } from 'bun:test';
import { ProvisioningError } from '../errors';
import { loadToml } from '../host/toml';
import { renderConfig } from './config';

const CONFIG = `version = 1

[repos.github]
path = "GitHub/project"
url = "git@github.com:owner/project.git"

[repos.https]
url = "https://github.com/owner/public.git"

[repos.other]
url = "git@gitlab.example:owner/project.git"
`;

function urls(rendered: string): Record<string, unknown> {
  const config = loadToml(rendered, 'rendered');
  return config['repos'] as Record<string, unknown>;
}

test('renders stock GitHub SSH remotes through the configured host', () => {
  expect(urls(renderConfig(CONFIG, 'github-work', 'grove.toml'))).toEqual({
    github: {
      path: 'GitHub/project',
      url: 'git@github-work:owner/project.git',
    },
    https: { url: 'https://github.com/owner/public.git' },
    other: { url: 'git@gitlab.example:owner/project.git' },
  });
});

test('keeps stock GitHub SSH remotes when the default host is selected', () => {
  const repos = urls(renderConfig(CONFIG, 'github.com', 'grove.toml'));
  expect(repos['github']).toEqual({
    path: 'GitHub/project',
    url: 'git@github.com:owner/project.git',
  });
});

test('rejects a repository without a string URL', () => {
  expect(() =>
    renderConfig('[repos.invalid]\nurl = 1\n', 'github.com', 'grove.toml'),
  ).toThrow(ProvisioningError);
});
