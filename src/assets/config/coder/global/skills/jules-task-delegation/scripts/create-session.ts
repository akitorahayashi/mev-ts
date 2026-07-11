#!/usr/bin/env bun
import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';

const API_URL = 'https://jules.googleapis.com/v1alpha';
const MAX_TITLE_BYTES = 255;
const encoder = new TextEncoder();

function fail(message: string): never {
  console.error(`Error: ${message}`);
  process.exit(1);
}

function usage(): never {
  console.error(
    'Usage: create-session.ts --prompt <text>|--prompt-file <file> --branch <branch> [--repo <owner/repo>]',
  );
  process.exit(1);
}

function trimRequired(value: string | undefined, label: string): string {
  const trimmed = value?.trim();
  if (!trimmed) fail(`${label} cannot be empty.`);
  return trimmed;
}

function validatePrompt(value: string | undefined): string {
  return trimRequired(value, 'Prompt');
}

function validateBranch(value: string | undefined): string {
  const branch = trimRequired(value, 'Starting branch');
  if (/\p{White_Space}/u.test(branch)) {
    fail('Starting branch cannot contain whitespace.');
  }
  return branch;
}

function validateTitle(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const sessionTitle = trimRequired(value, 'Title');
  if (encoder.encode(sessionTitle).length > MAX_TITLE_BYTES) {
    fail(`Title exceeds max length of ${MAX_TITLE_BYTES} bytes.`);
  }
  return sessionTitle;
}

function validateAutomationMode(value: string | undefined): string {
  return trimRequired(value, 'Automation mode');
}

function stripGitSuffix(repo: string): string {
  return repo.endsWith('.git') ? repo.slice(0, -4) : repo;
}

function parseGithubRepo(remoteUrl: string): string | null {
  const trimmed = remoteUrl.trim().replace(/\/$/, '');

  try {
    const url = new URL(trimmed);
    if (url.hostname.toLowerCase() === 'github.com') {
      const parts = url.pathname.replace(/^\/|\/$/g, '').split('/');
      if (parts.length === 2 && parts[0] && parts[1]) {
        return `${parts[0]}/${stripGitSuffix(parts[1])}`;
      }
    }
  } catch {
    // Fall through to scp-like SSH parsing.
  }

  const scpLike = trimmed.match(/^git@github\.com:([^/]+)\/(.+)$/);
  if (!scpLike) return null;
  const [, owner, repo] = scpLike;
  if (owner === undefined || repo === undefined) return null;
  return `${owner}/${stripGitSuffix(repo)}`;
}

function validateRepo(value: string): string {
  const repo = stripGitSuffix(value.trim());
  if (!/^[^\s/]+\/[^\s/]+$/.test(repo)) {
    fail(`Repository must use owner/repo format: ${value}`);
  }
  return repo;
}

function getGitRepo(): string | null {
  try {
    const remoteUrl = execFileSync(
      'git',
      ['config', '--get', 'remote.origin.url'],
      { encoding: 'utf-8' },
    );
    const repo = parseGithubRepo(remoteUrl);
    return repo === null ? null : validateRepo(repo);
  } catch {
    // Missing git or remote configuration is handled by the caller.
  }
  return null;
}

async function responseText(
  url: string,
  init: RequestInit,
): Promise<{ response: Response; body: string }> {
  const response = await fetch(url, init);
  return { response, body: await response.text() };
}

function formatBody(body: string): string {
  if (body.trim().length === 0) return '<empty response body>';
  try {
    return JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    return body;
  }
}

function parseJsonObject(body: string, label: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    fail(`${label} returned non-JSON body: ${formatBody(body)}`);
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    fail(`${label} returned a JSON value that is not an object.`);
  }
  return parsed as Record<string, unknown>;
}

function optionalString(
  object: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = object[key];
  return typeof value === 'string' ? value : undefined;
}

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      prompt: { type: 'string' },
      'prompt-file': { type: 'string' },
      branch: { type: 'string' },
      title: { type: 'string' },
      repo: { type: 'string' },
      'require-plan-approval': { type: 'boolean', default: false },
      'automation-mode': { type: 'string', default: 'AUTO_CREATE_PR' },
    },
  });

  const apiKey = process.env.JULES_API_KEY?.trim();
  if (!apiKey) {
    fail('JULES_API_KEY environment variable is required.');
  }

  if (
    (values.prompt === undefined && values['prompt-file'] === undefined) ||
    (values.prompt !== undefined && values['prompt-file'] !== undefined) ||
    values.branch === undefined
  ) {
    usage();
  }

  let promptText = values.prompt;
  if (values['prompt-file'] !== undefined) {
    promptText = await Bun.file(values['prompt-file']).text();
  }
  promptText = validatePrompt(promptText);
  const branch = validateBranch(values.branch);
  const title = validateTitle(values.title);
  const automationMode = validateAutomationMode(values['automation-mode']);

  let repo = values.repo === undefined ? undefined : validateRepo(values.repo);
  if (repo === undefined) {
    const detectedRepo = getGitRepo();
    if (!detectedRepo) {
      fail(
        'Could not auto-detect GitHub repo from git config. Specify --repo owner/repo.',
      );
    }
    repo = detectedRepo;
  }

  const sourceName = `sources/github/${repo}`;

  console.log(`Verifying source ${sourceName}...`);
  const { response: verifyRes, body: verifyBody } = await responseText(
    `${API_URL}/${sourceName}`,
    {
      headers: { 'x-goog-api-key': apiKey },
    },
  );

  if (!verifyRes.ok) {
    console.error(
      `Error: Source ${sourceName} not found or not accessible (HTTP ${verifyRes.status}).`,
    );
    console.error(formatBody(verifyBody));
    process.exit(1);
  }

  console.log('Creating session...');
  const payload: Record<string, unknown> = {
    prompt: promptText,
    sourceContext: {
      source: sourceName,
      githubRepoContext: {
        startingBranch: branch,
      },
    },
    requirePlanApproval: values['require-plan-approval'],
    automationMode,
  };
  if (title !== undefined) {
    payload.title = title;
  }

  const { response: createRes, body: createBody } = await responseText(
    `${API_URL}/sessions`,
    {
      method: 'POST',
      headers: {
        'x-goog-api-key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    },
  );

  if (!createRes.ok) {
    console.error(`Error creating session (HTTP ${createRes.status}):`);
    console.error(formatBody(createBody));
    process.exit(1);
  }

  const data = parseJsonObject(createBody, 'Create session');

  console.log('Session created successfully!');
  console.log(`ID:   ${optionalString(data, 'id') ?? ''}`);
  console.log(`Name: ${optionalString(data, 'name') ?? ''}`);
  console.log(`URL:  ${optionalString(data, 'url') ?? ''}`);
}

main().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
