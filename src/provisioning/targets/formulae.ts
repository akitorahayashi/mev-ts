import { target } from '../target';

/**
 * Baseline Homebrew formulae not owned by a dedicated tool target. Toolchain
 * formulae (uv, rbenv, fnm, …) live on their own targets; these are the
 * standalone command-line tools wanted on every development machine.
 */
export const formulaeTarget = target('formulae', {
  description: 'Baseline Homebrew formulae',
  aliases: ['br-f'],
  role: 'brew/formulae',
  packages: {
    formulae: [
      'mise',
      'shellcheck',
      'shfmt',
      'ripgrep',
      'bat',
      'eza',
      'fd',
      'jq',
      'yq',
      'postgresql',
      'redis',
      'poppler',
      'pandoc',
      'ffmpeg',
      'displayplacer',
      'rclone',
      'ollama',
      'tokei',
    ],
  },
  activations: [],
});
