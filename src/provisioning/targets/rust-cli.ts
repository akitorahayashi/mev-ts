import { releaseBinaries } from '../activation';
import { target } from '../target';

// Prebuilt CLI binaries published to GitHub Releases, fetched into ~/.cargo/bin
// rather than built with `cargo install`. They are independent of the rust
// target: the Rust toolchain need not be present for these to run.
export const rustCliTarget = target('rust-cli', {
  description: 'Prebuilt Rust CLI binaries from GitHub Releases',
  aliases: ['rs-cli'],
  role: 'rust-cli',
  activations: [
    releaseBinaries([
      {
        name: 'astm',
        repo: 'asterismhq/asterism',
        tag: 'v27.0.2',
        private: true,
      },
      { name: 'kpv', repo: 'akitorahayashi/kpv', tag: 'v0.6.0' },
      { name: 'mx', repo: 'akitorahayashi/mx', tag: 'v3.1.0' },
      { name: 'prf', repo: 'akitorahayashi/prf', tag: 'v1.0.0' },
      { name: 'ssv', repo: 'akitorahayashi/ssv', tag: 'v0.5.0' },
    ]),
  ],
});
