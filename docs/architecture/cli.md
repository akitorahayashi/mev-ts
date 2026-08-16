# CLI

## Dispatch

| Boundary | Contract |
|---|---|
| Command registration | `cli/commands/registry.ts` is the single public and hidden command registry. |
| Namespace help | Command paths derive help routing from the registry. |
| Command implementation | Each command subclasses `Command`. |

## Errors and output

| Error class | Output | Exit behavior |
|---|---|---|
| `CommandLineError` / `UsageError` | Usage and the error on stdout | Command-line failure |
| `AppError` or `ProvisioningError` | `<command>: <message>` on stderr | Exit code 1, without usage or a stack |
| Pure renderer result | Renderer-owned output | No domain-error wrapper |

The error hierarchy is defined in `src/errors.ts`; command routing and reporting
share the registry and the domain-error boundary.
