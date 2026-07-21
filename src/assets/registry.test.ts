import { expect, test } from 'bun:test';
import { embeddedAssets } from './registry';

// Scripts deployed as host executables. This hand-maintained allowlist is the
// independent reference for which assets must ship with the owner-execute bit —
// intentionally not derived from a mode-bit scan, which would only restate the
// code under test. A dropped +x fails the positive checks; a newly executable
// asset that skips this list fails the completeness check.
const EXECUTABLE_KEYS = [
  'coder/antigravity-cli/statusline.sh',
  'coder/claude/statusline.sh',
  'coder/hooks/claude/pre-tool-use.sh',
  'coder/hooks/codex/pre-tool-use.sh',
  'coder/rtk/rewrite.sh',
  'coder/skills/jules-task-delegation/scripts/create-session.ts',
];

for (const key of EXECUTABLE_KEYS) {
  test(`${key} ships with the owner-execute bit`, () => {
    expect(embeddedAssets.isExecutable(key)).toBe(true);
  });
}

test('no embedded asset outside the allowlist carries the execute bit', () => {
  const listed = new Set(EXECUTABLE_KEYS);
  const unlisted = embeddedAssets
    .keysByPrefix('')
    .filter((key) => !listed.has(key) && embeddedAssets.isExecutable(key));
  expect(unlisted).toEqual([]);
});
