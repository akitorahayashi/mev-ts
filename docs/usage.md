# Usage

Command reference for the `mev` CLI: every public subcommand, its aliases, and the behavior each produces.

## Provisioning

```bash
mev make git                   # Provision the git target
mev make git shell              # Provision multiple targets at once
```

`make` (alias `mk`) resolves each selector to a target, deploys embedded config assets to `~/.mev/roles/`, installs any missing Homebrew packages, then runs each activation idempotently. The repository config is the source of truth for declared outputs, so existing files, directories, or symlinks at those destinations are replaced by the current config. Activations report `changed`, `unchanged`, or `failed` per item. Each run ends with a report that summarizes required action, phase counts, changed targets, and retry selectors. See docs/architecture.md for the phase mechanics.

```bash
mev create                      # Provision the full environment
mev sync                        # Apply changed full-setup targets
mev s                           # Alias for sync
```

`create` (alias `cr`) provisions the full environment by running every target except the optional ones through the same phases as `make`. Optional GUI casks are deferred; install them on demand with `mev make br-c`.

`sync` (alias `s`) scans the same non-optional target set and runs only targets whose declared packages, activation intent, or embedded assets changed since their last successful application, plus targets whose deployed role assets drifted. Successful target signatures are stored under `~/.mev/applied/`; optional targets remain explicit `make` operations. See docs/architecture.md for the signature and staleness mechanics.

## Listing Targets

```bash
mev list                        # Show all available provisioning targets
```

## Config

```bash
mev config agents               # Toggle enabled AGENTS.md sections (alias: mev cf ag)
mev config skills                # Toggle enabled skills (alias: mev cf sk)
mev config zed                   # Toggle enabled Zed settings overrides (alias: mev cf zd)
mev config zed --clear           # Disable all Zed settings overrides
```

`config` (alias `cf`) groups the three selection commands above; each opens an interactive multi-select over its catalog. `--clear` disables every entry without opening the prompt. Catalog sources, manifest mechanics, and the Zed settings-merge algorithm are in docs/config.md.

## Git Identity

```bash
mev user                        # List git identity subcommands (alias: mev us)
mev user show                   # Show stored Git identities (personal + work)
mev user set                    # Configure identities interactively
mev switch personal             # Switch active Git identity (alias: mev sw)
mev switch work
```

`user` (alias `us`) groups the git identity subcommands. Identities are stored in `~/.mev/identity.json`. `switch` writes the selected name and email to the mutable `~/.gitconfig`; `make git` manages the separate static config at `~/.config/git/config`.

## Document Conversion

```bash
mev make shell                  # Install aliases and conversion dependencies
md2pdf README.md                # Write README.pdf beside the input
md2pdf docs -o exported         # Convert a directory recursively
md2pdf notes.md --css print.css --margin-top 20mm
pdf2md report.pdf               # Extract UTF-8 text to report.md
```

`md2pdf` and `pdf2md` are shell aliases for hidden `mev internal document` commands. Directory conversion preserves the relative tree and defaults to `document_outputs` when no output directory is given. `pdf2md` extracts text and does not reconstruct semantic Markdown structure from a PDF. See docs/architecture.md for the Pandoc, Chrome, and Poppler rendering mechanics.

## Global Flags

```
--help         Show command help
--version      Print the binary version
```
