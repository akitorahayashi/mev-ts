import { expect, test } from 'bun:test';
import { embeddedAssets } from './registry';

// Scripts deployed as host executables. `executableAssets` is derived from the
// checkout's mode bits, so a dropped +x would ship one of these non-executable;
// this guard is the independent reference that fails first when that happens.
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

test('a plain config asset is not marked executable', () => {
  expect(embeddedAssets.isExecutable('pipx/tools.yml')).toBe(false);
});
