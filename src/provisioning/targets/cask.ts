import { target } from '../target';

/**
 * The baseline Homebrew Cask GUI apps not owned by a dedicated target. Apps with
 * their own configuration (Ghostty, Zed, VS Code, Antigravity IDE) carry their
 * cask on that target; these are the standalone applications. Selecting this tag
 * is the per-machine decision that the Ansible role expressed as a profile.
 */
export const caskTarget = target('cask', {
  description: 'Baseline Homebrew Cask applications',
  aliases: ['ca'],
  role: 'cask',
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
