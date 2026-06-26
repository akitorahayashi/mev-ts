import { target } from '../target';

/**
 * The baseline Homebrew CLI formulae not owned by a language or tool target.
 * Toolchain formulae (uv, rbenv, fnm, …) live on their own targets; these are
 * the standalone command-line tools wanted on every development machine.
 */
export const brewTarget = target('brew', {
  description: 'Baseline Homebrew CLI tools',
  aliases: ['br'],
  role: 'brew',
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
