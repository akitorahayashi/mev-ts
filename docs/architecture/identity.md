# Git Identity

| Concern | Authority and state |
|---|---|
| Scope names and aliases | `identity/scope.ts` |
| Stored profiles | `~/.mev/identity.json` |
| Managed static Git config | `~/.config/git/config` |
| Active overlay | `~/.gitconfig` |
| Use cases | `app/identity.ts` handles show, set, and switch. |

The Git target owns the static XDG config. Identity switching writes the selected
`user.name` and `user.email` to the mutable overlay, preserving existing overlay
values that are unrelated to identity.
