import { expect, test } from 'bun:test';
import {
  createJulesSession,
  type Fetch,
  JulesScriptError,
  main,
  parseCliOptions,
  parseGithubRepo,
} from '../../src/assets/config/coder/skills/jules-task-delegation/scripts/create-session';

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status });
}

test('the Jules script exposes createJulesSession as an importable function', () => {
  expect(typeof createJulesSession).toBe('function');
});

test('parseGithubRepo accepts HTTPS and SSH GitHub remotes', () => {
  expect(parseGithubRepo('https://github.com/owner/repo.git')).toBe(
    'owner/repo',
  );
  expect(parseGithubRepo('git@github.com:owner/repo.git')).toBe('owner/repo');
});

test('parseCliOptions rejects mutually exclusive prompt inputs', async () => {
  await expect(
    parseCliOptions(
      ['--prompt', 'x', '--prompt-file', 'prompt.txt', '--branch', 'main'],
      async () => 'file prompt',
    ),
  ).rejects.toBeInstanceOf(JulesScriptError);
});

test('main rejects a missing API key before any network request', async () => {
  await expect(
    main(['--prompt', 'x', '--branch', 'main', '--repo', 'owner/repo'], {}),
  ).rejects.toBeInstanceOf(JulesScriptError);
});

test('createJulesSession maps a valid success response', async () => {
  const calls: string[] = [];
  const fetchImpl: Fetch = async (url) => {
    calls.push(String(url));
    return calls.length === 1
      ? jsonResponse({})
      : jsonResponse({ id: '1', name: 'sessions/1', url: 'https://jules/1' });
  };

  const session = await createJulesSession(
    {
      prompt: 'do work',
      branch: 'main',
      repo: 'owner/repo',
      requirePlanApproval: false,
      automationMode: 'AUTO_CREATE_PR',
    },
    'secret-key',
    fetchImpl,
  );

  expect(session).toEqual({
    id: '1',
    name: 'sessions/1',
    url: 'https://jules/1',
  });
  expect(calls).toHaveLength(2);
});

test('createJulesSession reports upstream automation-mode rejection', async () => {
  const fetchImpl: Fetch = async (_url, init) => {
    if (init?.method === 'POST') {
      return new Response('bad automation mode', { status: 400 });
    }
    return jsonResponse({});
  };

  await expect(
    createJulesSession(
      {
        prompt: 'do work',
        branch: 'main',
        repo: 'owner/repo',
        requirePlanApproval: false,
        automationMode: 'EXPERIMENTAL',
      },
      'secret-key',
      fetchImpl,
    ),
  ).rejects.toThrow('HTTP 400');
});

test('createJulesSession rejects malformed success data', async () => {
  const fetchImpl: Fetch = async (_url, init) =>
    init?.method === 'POST' ? jsonResponse({ id: '1' }) : jsonResponse({});

  await expect(
    createJulesSession(
      {
        prompt: 'do work',
        branch: 'main',
        repo: 'owner/repo',
        requirePlanApproval: false,
        automationMode: 'AUTO_CREATE_PR',
      },
      'secret-key',
      fetchImpl,
    ),
  ).rejects.toThrow("missing or invalid 'name'");
});

test('createJulesSession applies a request timeout', async () => {
  const fetchImpl: Fetch = async (_url, init) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      });
    });

  await expect(
    createJulesSession(
      {
        prompt: 'do work',
        branch: 'main',
        repo: 'owner/repo',
        requirePlanApproval: false,
        automationMode: 'AUTO_CREATE_PR',
      },
      'secret-key',
      fetchImpl,
      () => 'owner/repo',
      1,
    ),
  ).rejects.toThrow('timed out');
});
