# mev

`mev` is Local IaC for macOS, built with Bun and TypeScript.

## Install

`mev` ships as a single compiled binary for macOS on Apple Silicon and Intel:

```bash
/bin/bash -c "$(curl --proto '=https' --proto-redir '=https' --tlsv1.2 -fsSL https://raw.githubusercontent.com/akitorahayashi/mev-ts/main/install.sh)"
```

The script downloads the release binary for the host architecture, verifies its SHA256 checksum, and installs it to `~/.local/bin/mev`. `MEV_INSTALL_DIR` overrides the destination and `MEV_VERSION=vX.Y.Z` pins a release instead of the latest. Ensure the install directory is on `PATH`, then verify:

```bash
mev --version
```

Homebrew is a prerequisite; `mev` installs packages through it but does not bootstrap it:

```bash
/bin/bash -c "$(curl --proto '=https' --proto-redir '=https' --tlsv1.2 -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

## Development

From a clone, install dependencies and run from source:

```bash
bun install
bun e --version
MEV_INSTALL_DIR="$HOME/.local/bin" bun run up
mev --version
```

`bun run up` is the local self-update path for a development clone. It regenerates the embedded asset registry, builds a Bun-targeted single-file JavaScript bundle, and installs it as `mev`. This replaces any previously installed standalone release binary at that path; the release installer remains the clean-install path for machines that do not yet have Bun. The full local verification task surface is in CONTRIBUTING.md.

## Usage

```bash
mev create                      # Provision the full environment
mev sync                        # Re-apply only what changed since the last run
```

`create` runs every registered target except the optional ones through the deploy, package-install, and activation phases; `sync` re-scans the same targets and re-applies only the ones whose declared state or deployed assets changed. The complete command reference — `make`, `config`, `list`, `user`/`switch`, and the `md2pdf`/`pdf2md` conversion aliases — is in docs/usage.md. Provisioning mechanics and the activation DSL are in docs/architecture.md; the `mev config` selection surfaces are in docs/config.md.
