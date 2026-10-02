# mev

`mev` is Local IaC for macOS, built with Bun and TypeScript.

## Install

Homebrew is required when provisioning targets declare Homebrew packages; `mev` does not bootstrap it. On a fresh macOS installation, Homebrew comes first:

```bash
/bin/bash -c "$(curl --proto '=https' --proto-redir '=https' --tlsv1.2 -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

The Homebrew installer's Next steps configure the shell's PATH. Those steps must be applied before a new terminal session can find `brew`. Opening a new terminal loads the updated shell configuration; running the recommended `eval "$(.../bin/brew shellenv)"` command in the current terminal makes Homebrew available immediately without a restart. The [Homebrew installation guide](https://docs.brew.sh/Installation#post-installation-steps) describes this setup. Once Homebrew is available:

```bash
brew --version
```

`mev` ships as a single compiled binary for macOS on Apple Silicon and Intel:

```bash
/bin/bash -c "$(curl --proto '=https' --proto-redir '=https' --tlsv1.2 -fsSL https://raw.githubusercontent.com/akitorahayashi/mev-ts/main/install.sh)"
```

The script downloads the release binary for the host architecture, verifies its SHA256 checksum, and installs it to `~/.local/bin/mev`. It reports the installed binary's version and destination. `MEV_INSTALL_DIR` overrides the destination and `MEV_VERSION=vX.Y.Z` pins a release instead of the latest. The following commands make the default install directory available for the current terminal session and start provisioning:

```bash
export PATH="$HOME/.local/bin:$PATH"
mev --version
mev create
```

For a custom `MEV_INSTALL_DIR`, the installer prints a PATH command using that directory. Install directories containing `:` are rejected before downloading or installing because `:` separates PATH entries. The installer does not edit shell configuration files or change its parent shell's PATH. Homebrew is not required to install `mev` or inspect its version; a provisioning run that needs Homebrew checks it before changing provisioning state.

Installed releases update and reconcile the environment in one command:

```bash
mev update
mev update --upgrade
```

`update` resolves the latest published release, verifies and atomically replaces
the installed command when needed, then runs `sync` from that exact path. The
`--upgrade` form forwards the existing upgrade intent to `sync`.

## Development

From a clone, install dependencies and run from source:

```bash
bun install
bun e --version
MEV_INSTALL_DIR="$HOME/.local/bin" bun run up
export PATH="$HOME/.local/bin:$PATH"
mev --version
```

`bun run up` is the local installation path for a development clone. It regenerates the embedded asset registry, builds a Bun-targeted single-file JavaScript bundle, and installs it as `mev`. This replaces any previously installed standalone release binary at that path; the release installer remains the clean-install path for machines that do not yet have Bun. The full local verification task surface is in CONTRIBUTING.md.

## Usage

```bash
mev create                      # Provision the full environment
mev sync                        # Re-apply only what changed since the last run
mev update                      # Install the latest release and then sync
```

`create` runs every registered target except the optional ones through the deploy, package-install, and activation phases; `sync` re-scans the same targets and re-applies only the ones whose declared state or deployed assets changed. The complete command reference — `make`, `sync`, `update`, `config`, `list`, `user`/`switch`, and the `md2pdf`/`pdf2md` conversion aliases — is in docs/usage.md. Provisioning mechanics are in docs/architecture/provisioning.md, the activation DSL in docs/architecture/activation.md; the `mev config` selection surfaces are in docs/config.md.
