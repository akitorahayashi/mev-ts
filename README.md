# mev

`mev` is a macOS development environment provisioning CLI built with Bun and TypeScript.

## Setup

Homebrew is a prerequisite; `mev` installs packages through it but does not
bootstrap it. Install it first:

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

Then install dependencies:

```bash
bun install
```

## Usage

### Provisioning

```bash
mev make git                   # Provision the git target
mev make git shell              # Provision multiple targets at once
mev make shell --plan           # Preview what would change without applying
mev make shell -o               # Replace existing unmanaged files when linking
```

`make` (alias `mk`) resolves each tag to a target, deploys embedded config assets to `~/.config/mev/roles/`, installs any missing Homebrew packages, then runs each activation idempotently. Activations report `changed`, `unchanged`, or `failed` per item.

```bash
mev create mbk                  # Provision a full MacBook environment
mev create mac-mini             # Profiles: macbook/mbk, mac-mini/mmn
mev create mmn --plan           # Preview the full environment without applying
```

`create` (alias `cr`) provisions a full environment for a hardware profile by running every target except the optional ones through the same phases as `make`. Optional GUI casks are deferred; install them on demand with `mev make br-c`.

### Listing targets

```bash
mev list                        # Show all available provisioning targets
```

### Git identity

```bash
mev user                        # Show stored Git identities (personal + work)
mev user set                    # Configure identities interactively
mev switch personal             # Switch active Git identity (alias: mev sw)
mev switch work
```

Identities are stored in `~/.config/mev/identity.json`. `switch` writes the selected name and email to `~/.gitconfig`.

### Global flags

```
--plan         Preview activations without applying them
-o, --overwrite  Replace existing unmanaged files when linking configs
--help         Show command help
--version      Print the binary version
```
