#!/usr/bin/env bun
import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';

const API_URL = 'https://jules.googleapis.com/v1alpha';
const MAX_TITLE_BYTES = 255;
const REQUEST_TIMEOUT_MS = 30_000;
const encoder = new TextEncoder();

export interface ParsedOptions {
  readonly prompt: string;
  readonly branch: string;
  readonly repo?: string;
  readonly title?: string;
  readonly requirePlanApproval: boolean;
  readonly automationMode: string;
}

export interface SessionResult {
  readonly id: string;
  readonly name: string;
  readonly url: string;
}

interface FetchResult {
  readonly response: Response;
  readonly body: string;
}

export type Fetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export class JulesScriptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JulesScriptError';
  }
}

function fail(message: string): never {
  throw new JulesScriptError(message);
}

function usage(): never {
  fail(
    'Usage: create-session.ts --prompt <text>|--prompt-file <file> --branch <branch>\n' +
      '  [--repo <owner/repo>] [--title <title>] [--require-plan-approval] [--automation-mode <mode>]',
  );
}

function trimRequired(value: string | undefined, label: string): string {
  const trimmed = value?.trim();
  if (!trimmed) fail(`${label} cannot be empty.`);
  return trimmed;
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

export function parseGithubRepo(remoteUrl: string): string | null {
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

export function getGitRepo(): string | null {
  try {
    const remoteUrl = execFileSync(
      'git',
      ['config', '--get', 'remote.origin.url'],
      { encoding: 'utf-8' },
    );
    const repo = parseGithubRepo(remoteUrl);
    return repo === null ? null : validateRepo(repo);
  } catch {
    return null;
  }
}

export async function parseCliOptions(
  argv: readonly string[],
  readFile: (path: string) => Promise<string>,
): Promise<ParsedOptions> {
  const { values } = parseArgs({
    args: [...argv],
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

  if (
    (values.prompt === undefined && values['prompt-file'] === undefined) ||
    (values.prompt !== undefined && values['prompt-file'] !== undefined) ||
    values.branch === undefined
  ) {
    usage();
  }

  const prompt =
    values['prompt-file'] === undefined
      ? trimRequired(values.prompt, 'Prompt')
      : trimRequired(await readFile(values['prompt-file']), 'Prompt');

  return {
    prompt,
    branch: validateBranch(values.branch),
    repo: values.repo === undefined ? undefined : validateRepo(values.repo),
    title: validateTitle(values.title),
    requirePlanApproval: values['require-plan-approval'] ?? false,
    automationMode: validateAutomationMode(values['automation-mode']),
  };
}

async function responseText(
  fetchImpl: Fetch,
  url: string,
  init: RequestInit,
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<FetchResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { ...init, signal: controller.signal });
    return { response, body: await response.text() };
  } catch (error) {
    if ((error as Error).name === 'AbortError') {
      fail(`Request timed out after ${timeoutMs / 1000} seconds.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
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

function requiredString(
  object: Record<string, unknown>,
  key: string,
  label: string,
): string {
  const value = object[key];
  if (typeof value !== 'string' || value.trim() === '') {
    fail(`${label} returned missing or invalid '${key}'.`);
  }
  return value;
}

export async function createJulesSession(
  options: ParsedOptions,
  apiKey: string,
  fetchImpl: Fetch = fetch,
  repoDetector: () => string | null = getGitRepo,
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<SessionResult> {
  const repo = options.repo ?? repoDetector();
  if (!repo) {
    fail('Could not auto-detect GitHub repo from git config. Specify --repo owner/repo.');
  }
  const sourceName = `sources/github/${repo}`;

  const { response: verifyRes, body: verifyBody } = await responseText(
    fetchImpl,
    `${API_URL}/${sourceName}`,
    { headers: { 'x-goog-api-key': apiKey } },
    timeoutMs,
  );
  if (!verifyRes.ok) {
    fail(
      `Source ${sourceName} not found or not accessible (HTTP ${verifyRes.status}):\n${formatBody(verifyBody)}`,
    );
  }

  const payload: Record<string, unknown> = {
    prompt: options.prompt,
    sourceContext: {
      source: sourceName,
      githubRepoContext: { startingBranch: options.branch },
    },
    requirePlanApproval: options.requirePlanApproval,
    automationMode: options.automationMode,
  };
  if (options.title !== undefined) payload.title = options.title;

  const { response: createRes, body: createBody } = await responseText(
    fetchImpl,
    `${API_URL}/sessions`,
    {
      method: 'POST',
      headers: {
        'x-goog-api-key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    },
    timeoutMs,
  );
  if (!createRes.ok) {
    fail(`Error creating session (HTTP ${createRes.status}):\n${formatBody(createBody)}`);
  }

  const data = parseJsonObject(createBody, 'Create session');
  return {
    id: requiredString(data, 'id', 'Create session'),
    name: requiredString(data, 'name', 'Create session'),
    url: requiredString(data, 'url', 'Create session'),
  };
}

export async function main(
  argv = Bun.argv.slice(2),
  env: Record<string, string | undefined> = process.env,
): Promise<void> {
  const apiKey = env.JULES_API_KEY?.trim();
  if (!apiKey) fail('JULES_API_KEY environment variable is required.');
  const options = await parseCliOptions(argv, (path) => Bun.file(path).text());

  console.log('Creating session...');
  const session = await createJulesSession(options, apiKey);
  console.log('Session created successfully!');
  console.log(`ID:   ${session.id}`);
  console.log(`Name: ${session.name}`);
  console.log(`URL:  ${session.url}`);
}

if (import.meta.main) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Error: ${message}`);
    process.exit(1);
  });
}
