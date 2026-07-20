import { runCommand } from '../activation';
import { target } from '../target';

// rustup manages the Rust toolchain the way fnm/rbenv manage their runtimes, but
// it is installed through the official installer rather than Homebrew: rustup
// self-updates (`rustup self update`) and the Rust project does not support a
// brew-managed install. The installer is trusted over HTTPS; it verifies the
// rustup-init binary it downloads, so no separate checksum step is carried.
export const rustTarget = target('rust', {
  description: 'Rust toolchain via rustup',
  aliases: ['rs'],
  role: 'rust',
  activations: [
    runCommand({
      label: 'rust toolchain',
      reads: {
        version: 'rust/.rust-version',
        targets: 'rust/targets',
        components: 'rust/components',
      },
      steps: [
        {
          label: 'rustup install',
          argv: (s) => [
            'sh',
            '-c',
            `curl --proto '=https' --tlsv1.2 -fsSL https://sh.rustup.rs | sh -s -- -y --no-modify-path --profile minimal --default-toolchain ${s.ref('version')}`,
          ],
          skipIf: (s) => ({ pathExists: `${s.home}/.cargo/bin/rustup` }),
        },
        {
          label: 'rustup default',
          argv: (s) => [
            `${s.home}/.cargo/bin/rustup`,
            'default',
            s.ref('version'),
          ],
          skipIf: (s) => ({
            commandSucceeds: [
              'sh',
              '-c',
              `"${s.home}/.cargo/bin/rustup" default | grep -q "${s.ref('version')}"`,
            ],
          }),
        },
        {
          label: 'rustup component add',
          argv: (s) => [
            `${s.home}/.cargo/bin/rustup`,
            'component',
            'add',
            ...s.ref('components').split(/\s+/).filter(Boolean),
          ],
          skipIf: (s) => ({
            commandSucceeds: ['test', '-z', s.ref('components')],
          }),
          changedWhen: { outputContains: 'installing' },
        },
        {
          label: 'rustup target add',
          argv: (s) => [
            `${s.home}/.cargo/bin/rustup`,
            'target',
            'add',
            ...s.ref('targets').split(/\s+/).filter(Boolean),
          ],
          skipIf: (s) => ({
            commandSucceeds: ['test', '-z', s.ref('targets')],
          }),
          changedWhen: { outputContains: 'installing' },
        },
      ],
    }),
  ],
});
