import { asset } from '../../assets/ref';
import { AGENTS_SECTIONS_PREFIX, SKILLS_PREFIX } from '../../coder/paths';
import { home, mevPath } from '../../host/path';
import {
  brewPath,
  brewPrefixCapture,
  coderAgents,
  coderSkills,
  link,
  remoteInstaller,
  runCommand,
  versionCheckStep,
} from '../activation';
import { target } from '../target';

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

export const coderTarget = target('coder', {
  description: 'AI coding agents (Claude Code, Codex, Antigravity CLI)',
  aliases: ['cdr'],
  role: 'coder',
  packages: { formulae: ['rtk'] },
  activations: [
    remoteInstaller({
      label: 'install claude',
      url: 'https://claude.ai/install.sh',
      integrity: { acknowledgedUnverified: true },
      interpreter: 'bash',
      args: [],
      creates: home('.local/bin/claude'),
      pathPrefix: [home('.local/bin')],
    }),
    remoteInstaller({
      label: 'install codex',
      url: 'https://chatgpt.com/codex/install.sh',
      integrity: { acknowledgedUnverified: true },
      interpreter: 'sh',
      args: [],
      creates: home('.local/bin/codex'),
      env: { CODEX_NON_INTERACTIVE: 'true' },
      pathPrefix: [home('.local/bin')],
    }),
    remoteInstaller({
      label: 'install antigravity cli',
      url: 'https://antigravity.google/cli/install.sh',
      integrity: { acknowledgedUnverified: true },
      interpreter: 'bash',
      args: [],
      creates: home('.local/bin/agy'),
      pathPrefix: [home('.local/bin')],
    }),
    runCommand({
      label: 'coder CLIs',
      steps: [
        brewPrefixCapture(),
        versionCheckStep('claude --version', {
          concat: [{ ref: 'home' }, '/.local/bin/claude'],
        }),
        versionCheckStep('codex --version', {
          concat: [{ ref: 'home' }, '/.local/bin/codex'],
        }),
        versionCheckStep('agy --version', {
          concat: [{ ref: 'home' }, '/.local/bin/agy'],
        }),
        versionCheckStep(
          'rtk --version',
          'rtk',
          brewPath([{ concat: [{ ref: 'home' }, '/.local/bin'] }]),
        ),
      ],
    }),
    link(asset('coder/claude/settings.json'), home('.claude/settings.json')),
    link(asset('coder/claude/statusline.sh'), home('.claude/statusline.sh')),
    link(asset('coder/codex/config.toml'), home('.codex/config.toml')),
    link(asset('coder/codex/hooks.json'), home('.codex/hooks.json')),
    link(
      asset('coder/antigravity-cli/settings.json'),
      home('.gemini/antigravity-cli/settings.json'),
    ),
    link(
      asset('coder/antigravity-cli/statusline.sh'),
      home('.gemini/antigravity-cli/statusline.sh'),
    ),
    link(asset('coder/rtk/rewrite.sh'), mevPath('rtk/rewrite.sh')),
    link(
      asset('coder/hooks/claude/pre-tool-use.sh'),
      mevPath('hooks/claude/pre-tool-use.sh'),
    ),
    link(
      asset('coder/hooks/codex/pre-tool-use.sh'),
      mevPath('hooks/codex/pre-tool-use.sh'),
    ),
    coderAgents(AGENTS_SECTIONS_PREFIX, AGENTS_DESTS),
    coderSkills(SKILLS_PREFIX, SKILLS_TARGETS),
  ],
});
