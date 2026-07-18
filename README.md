# mev

`mev` is Local IaC for macOS, built with Bun and TypeScript.

## Install

`mev` ships as a single compiled binary for macOS on Apple Silicon and Intel:

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/akitorahayashi/mev-ts/main/install.sh)"
```

The script downloads the release binary for the host architecture, verifies its SHA256 checksum, and installs it to `~/.local/bin/mev`. `MEV_INSTALL_DIR` overrides the destination and `MEV_VERSION=vX.Y.Z` pins a release instead of the latest. Ensure the install directory is on `PATH`, then verify:

```bash
mev --version
```

Homebrew is a prerequisite; `mev` installs packages through it but does not bootstrap it:

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

## Development

From a clone, install dependencies and run from source:

```bash
bun install
bun e --version
MEV_INSTALL_DIR="$HOME/.local/bin" bun run up
mev --version
```

`bun run up` is the local self-update path for a development clone. It regenerates the embedded asset registry, builds a Bun-targeted single-file JavaScript bundle, and installs it as `mev`. This replaces any previously installed standalone release binary at that path; the release installer remains the clean-install path for machines that do not yet have Bun.

## Usage

### Provisioning

```bash
mev make git                   # Provision the git target
mev make git shell              # Provision multiple targets at once
mev make shell -o               # Replace existing unmanaged files when linking
```

`make` (alias `mk`) resolves each tag to a target, deploys embedded config assets to `~/.mev/roles/`, installs any missing Homebrew packages, then runs each activation idempotently. Activations report `changed`, `unchanged`, or `failed` per item.
Each run ends with a report that summarizes required action, phase counts, changed targets, and retry tags.

```bash
mev create mbk                  # Provision a full MacBook environment
mev create mac-mini             # Profiles: macbook/mbk, mac-mini/mmn
```

`create` (alias `cr`) provisions a full environment for a hardware profile by running every target except the optional ones through the same phases as `make`. Optional GUI casks are deferred; install them on demand with `mev make br-c`.

### Listing targets

```bash
mev list                        # Show all available provisioning targets
```

### Config

```bash
mev config agents               # Toggle enabled AGENTS.md sections (alias: mev cf ag)
mev config skills                # Toggle enabled skills (alias: mev cf sk)
mev config zed                   # Toggle enabled Zed settings overrides (alias: mev cf zd)
mev config zed --clear           # Disable all Zed settings overrides
```

`config` (alias `cf`) groups interactive selection commands. `config zed` merges the enabled override fragments in `src/assets/config/zed/global/overrides/` onto the base `settings.json`, failing loudly if two enabled overrides set the same key; adding a new override is a matter of dropping another `<name>.json` file into that directory.

### Git identity

```bash
mev user                        # List git identity subcommands (alias: mev us)
mev user show                   # Show stored Git identities (personal + work)
mev user set                    # Configure identities interactively
mev switch personal             # Switch active Git identity (alias: mev sw)
mev switch work
```

`user` (alias `us`) groups the git identity subcommands. Identities are stored in `~/.mev/identity.json`. `switch` writes the selected name and email to `~/.gitconfig`.

### Document conversion

```bash
mev make shell                  # Install aliases and conversion dependencies
md2pdf README.md                # Write README.pdf beside the input
md2pdf docs -o exported         # Convert a directory recursively
md2pdf notes.md --css print.css --margin-top 20mm
pdf2md report.pdf               # Extract UTF-8 text to report.md
```

`md2pdf` and `pdf2md` are shell aliases for hidden `mev internal document` commands. Directory conversion preserves the relative tree and defaults to `document_outputs` when no output directory is given. Markdown rendering uses Pandoc syntax highlighting and MathML, renders fenced `mermaid` blocks in an isolated Google Chrome page, and prints with the embedded A4 stylesheet. `pdf2md` uses Poppler text extraction; it does not reconstruct semantic Markdown structure from a PDF.

### Global flags

```
-o, --overwrite  Replace existing unmanaged files when linking configs
--help         Show command help
--version      Print the binary version
```
