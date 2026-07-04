import { releaseBinaries } from '../activation';
import { target } from '../target';

// Prebuilt CLI binaries published to GitHub Releases, fetched into ~/.cargo/bin
// rather than built with `cargo install`. They are independent of the rust
// target: the Rust toolchain need not be present for these to run.
export const rustCliTarget = target('rust-cli', {
  description: 'Prebuilt Rust CLI binaries from GitHub Releases',
  aliases: ['rs-cli'],
  role: 'rust-cli',
  activations: [releaseBinaries('rust-cli/global/binaries.yml')],
});
