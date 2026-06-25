import { asset } from '../../assets/ref';
import { home } from '../../host/path';
import { coderAgents, coderSkills, link, runCommand } from '../activation';
import { target } from '../target';

const SECTIONS_PREFIX = 'coder/global/agents-sections';
const SKILLS_PREFIX = 'coder/global/skills';

/** Agent tools whose instruction file is the generated AGENTS.md. */
const AGENTS_DESTS = [
  home('.claude/CLAUDE.md'),
  home('.codex/AGENTS.md'),
  home('.config/zed/AGENTS.md'),
  home('.gemini/GEMINI.md'),
];

/** Agent tools whose skills directory receives one symlink per enabled skill. */
const SKILLS_TARGETS = [
  home('.agents/skills'),
  home('.claude/skills'),
  home('.config/google/antigravity/skills'),
  home('.gemini/antigravity-cli/skills'),
];

/** PATH carrying the per-user bin directory the CLI installers write into. */
const localBinPath = (s: { home: string; basePath: string }) => ({
  PATH: `${s.home}/.local/bin:${s.basePath}`,
});

export const coderTarget = target('coder', {
  description: 'AI coding agents (Claude Code, Codex, Antigravity CLI)',
  aliases: ['cdr'],
  role: 'coder',
  activations: [
    runCommand({
      label: 'coder CLIs',
      steps: [
        {
          label: 'install claude',
          argv: () => [
            'sh',
            '-c',
            'set -o pipefail; curl -fsSL https://claude.ai/install.sh | bash',
          ],
          skipIf: (s) => ({ pathExists: `${s.home}/.local/bin/claude` }),
          env: localBinPath,
          changedWhen: 'always',
        },
        {
          label: 'claude --version',
          argv: (s) => [`${s.home}/.local/bin/claude`, '--version'],
          changedWhen: 'never',
        },
        {
          label: 'install codex',
          argv: () => [
            'sh',
            '-c',
            'set -o pipefail; curl -fsSL https://chatgpt.com/codex/install.sh | sh',
          ],
          skipIf: (s) => ({ pathExists: `${s.home}/.local/bin/codex` }),
          env: (s) => ({ ...localBinPath(s), CODEX_NON_INTERACTIVE: 'true' }),
          changedWhen: 'always',
        },
        {
          label: 'codex --version',
          argv: (s) => [`${s.home}/.local/bin/codex`, '--version'],
          changedWhen: 'never',
        },
        {
          label: 'install antigravity cli',
          argv: () => [
            'sh',
            '-c',
            'set -o pipefail; curl -fsSL https://antigravity.google/cli/install.sh | bash',
          ],
          skipIf: (s) => ({ pathExists: `${s.home}/.local/bin/agy` }),
          env: localBinPath,
          changedWhen: 'always',
        },
        {
          label: 'agy --version',
          argv: (s) => [`${s.home}/.local/bin/agy`, '--version'],
          changedWhen: 'never',
        },
        {
          label: 'rtk --version',
          argv: () => ['rtk', '--version'],
          env: (s) => ({
            PATH: `/opt/homebrew/bin:/usr/local/bin:${s.home}/.local/bin:${s.basePath}`,
          }),
          changedWhen: 'never',
        },
      ],
    }),
    link(
      asset('coder/global/claude/settings.json'),
      home('.claude/settings.json'),
    ),
    link(
      asset('coder/global/claude/statusline.sh'),
      home('.claude/statusline.sh'),
    ),
    link(asset('coder/global/codex/config.toml'), home('.codex/config.toml')),
    link(asset('coder/global/codex/hooks.json'), home('.codex/hooks.json')),
    link(
      asset('coder/global/antigravity-cli/settings.json'),
      home('.gemini/antigravity-cli/settings.json'),
    ),
    link(
      asset('coder/global/antigravity-cli/statusline.sh'),
      home('.gemini/antigravity-cli/statusline.sh'),
    ),
    link(asset('coder/global/rtk/rewrite.sh'), home('.mev/rtk/rewrite.sh')),
    link(
      asset('coder/global/hooks/claude/pre-tool-use.sh'),
      home('.mev/hooks/claude/pre-tool-use.sh'),
    ),
    link(
      asset('coder/global/hooks/codex/pre-tool-use.sh'),
      home('.mev/hooks/codex/pre-tool-use.sh'),
    ),
    coderAgents(SECTIONS_PREFIX, AGENTS_DESTS),
    coderSkills(SKILLS_PREFIX, SKILLS_TARGETS),
  ],
});
