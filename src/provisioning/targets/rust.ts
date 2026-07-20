import { home } from '../../host/path';
import { remoteInstaller, runCommand } from '../activation';
import { target } from '../target';

function rustupHostTriple(): string {
  if (process.arch === 'arm64') return 'aarch64-apple-darwin';
  if (process.arch === 'x64') return 'x86_64-apple-darwin';
  throw new Error(`Unsupported macOS Rust host architecture: ${process.arch}`);
}

function rustupInitUrl(triple = rustupHostTriple()): string {
  return `https://static.rust-lang.org/rustup/dist/${triple}/rustup-init`;
}

// rustup manages the Rust toolchain the way fnm/rbenv manage their runtimes.
// The official macOS rustup-init binary is downloaded directly with its adjacent
// SHA256 document instead of piping the bootstrap shell script into an
// interpreter.
export const rustTarget = target('rust', {
  description: 'Rust toolchain via rustup',
  aliases: ['rs'],
  role: 'rust',
  activations: [
    remoteInstaller({
      label: 'rustup install',
      url: rustupInitUrl(),
      integrity: { checksumUrl: `${rustupInitUrl()}.sha256` },
      interpreter: 'direct',
      args: ['-y', '--no-modify-path', '--profile', 'minimal'],
      creates: home('.cargo/bin/rustup'),
    }),
    runCommand({
      label: 'rust toolchain',
      intentVersion: 1,
      reads: {
        version: 'rust/.rust-version',
        targets: 'rust/targets',
        components: 'rust/components',
      },
      steps: [
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
