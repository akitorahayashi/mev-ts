import { target } from '../target';

/**
 * Baseline Homebrew casks not owned by a dedicated tool target. Apps with their
 * own configuration (Ghostty, Zed, VS Code, Antigravity IDE) carry their cask on
 * that target; these are the standalone GUI applications. Marked `optional` so a
 * full-environment `create` defers them; install on demand with `mev make br-c`.
 */
export const caskTarget = target('cask', {
  description: 'Baseline Homebrew casks',
  aliases: ['br-c'],
  role: 'brew/cask',
  optional: true,
  packages: {
    casks: [
      'docker',
      'google-chrome',
      'iina',
      'ngrok',
      'obsidian',
      'slack',
      'tailscale',
    ],
  },
  activations: [],
});
