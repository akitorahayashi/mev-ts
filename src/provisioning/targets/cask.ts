import { target } from '../target';

/**
 * Baseline Homebrew casks not owned by a dedicated tool target. Apps with their
 * own configuration (Ghostty, Zed, VS Code, Antigravity IDE) carry their cask on
 * that target; these are the standalone GUI applications. Machines that want no
 * GUI apps simply do not select this tag.
 */
export const caskTarget = target('cask', {
  description: 'Baseline Homebrew casks',
  aliases: ['br-c'],
  role: 'brew/cask',
  packages: {
    casks: [
      'tailscale',
      'docker',
      'google-chrome',
      'slack',
      'obsidian',
      'iina',
      'ngrok',
    ],
  },
  activations: [],
});
