# Git Identity

| Concern | Authority and state |
|---|---|
| Scope names and aliases | `identity/scope.ts` |
| Stored profiles | `~/.mev/identity.json` |
| Managed static Git config | `~/.config/git/config` |
| Active overlay | `~/.gitconfig` |
| Repository pin | `.git/config` of the current repository, written through `git config --local` so linked worktrees resolve to their shared config. |
| Use cases | `app/identity.ts` handles show, set, switch, pin, and unpin. |

The Git target owns the static XDG config. Identity switching writes the selected
`user.name` and `user.email` to the mutable overlay, preserving existing overlay
values that are unrelated to identity. Pinning writes the same keys to the
repository-local config instead. Git resolves `.git/config` over `~/.gitconfig`
over `~/.config/git/config`, so a pin shadows every later global switch until it
is unset.
