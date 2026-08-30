import { asset } from '../../assets/ref';
import { AGENTS_SECTIONS_PREFIX, SKILLS_PREFIX } from '../../coder/paths';
import { home, mevPath } from '../../host/path';
import {
  brewPath,
  brewPrefixCapture,
  coderAgents,
  coderSkills,
  declaredKeys,
  installAgentPlugins,
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
];

/** Agent tools whose skills directory receives one symlink per enabled skill. */
const SKILLS_TARGETS = [home('.agents/skills'), home('.claude/skills')];

const CLAUDE_BINARY = {
  concat: [{ ref: 'home' }, '/.local/bin/claude'],
} as const;
const CODEX_BINARY = {
  concat: [{ ref: 'home' }, '/.local/bin/codex'],
} as const;

export const coderTarget = target('coder', {
  description: 'AI coding agents (Claude Code, Codex)',
  aliases: ['cdr'],
  role: 'coder',
  packages: { formulae: ['rtk'] },
  // Marketplace registrations persist the SSH alias inside each client's
  // config, so a host change leaves materialized state behind; invalidating
  // here lets `sync` reselect the target, whose registration probe then
  // re-registers the drifted marketplaces.
  perMachineInputs: ['githubSshHost'],
  activations: [
    remoteInstaller({
      label: 'install claude',
      url: 'https://claude.ai/install.sh',
      integrity: { acknowledgedUnverified: true },
      interpreter: 'bash',
      args: [],
      creates: home('.local/bin/claude'),
      skipIf: { commandSucceeds: [CLAUDE_BINARY, '--version'] },
      pathPrefix: [home('.local/bin')],
    }),
    remoteInstaller({
      label: 'install codex',
      url: 'https://chatgpt.com/codex/install.sh',
      integrity: { acknowledgedUnverified: true },
      interpreter: 'sh',
      args: [],
      creates: home('.local/bin/codex'),
      skipIf: { commandSucceeds: [CODEX_BINARY, '--version'] },
      env: { CODEX_NON_INTERACTIVE: 'true' },
      pathPrefix: [home('.local/bin')],
    }),
    runCommand({
      label: 'rtk CLI',
      steps: [
        brewPrefixCapture(),
        versionCheckStep(
          'rtk --version',
          'rtk',
          brewPath([{ concat: [{ ref: 'home' }, '/.local/bin'] }]),
        ),
      ],
    }),
    // Merged, not linked: claude persists plugin enablement (`enabledPlugins`)
    // and interactively-toggled settings in this file at runtime, so a symlink
    // into the deploy store would route those writes into the deployed role and
    // every deploy would wipe them — which is how declared plugins ended up
    // installed but disabled.
    declaredKeys(
      asset('coder/claude/settings.json'),
      home('.claude/settings.json'),
      'json',
    ),
    link(asset('coder/claude/statusline.sh'), home('.claude/statusline.sh')),
    // Merged for the same reason: codex persists plugin/marketplace
    // registrations and app-managed tables in this file at runtime.
    declaredKeys(
      asset('coder/codex/config.toml'),
      home('.codex/config.toml'),
      'toml',
    ),
    link(asset('coder/codex/hooks.json'), home('.codex/hooks.json')),
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
    installAgentPlugins('coder/plugins.yml', [home('.local/bin')]),
  ],
});
