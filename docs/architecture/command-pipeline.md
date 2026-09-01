# Command Pipeline

`runCommand` represents host-command work as declarative data. The declaration
is both the execution input and part of the target signature.

## Scope

| Source | Values |
|---|---|
| Reserved facts | `home` and `basePath` (the captured inherited `PATH`) |
| `reads` | Trimmed content from declared embedded assets |
| Prior captures | Trimmed stdout registered by an earlier step |

An unresolved `ref` is a provisioning error; undefined arguments never become a
silent empty value.

## Step vocabulary

| Field | Contract |
|---|---|
| `argv` | Literal tokens, references, whitespace-split references, or concatenations |
| `env` | Inherited environment with literal, reference, concatenated, or path-list values overlaid |
| `skipIf` | Declarative path, command-success, or output-match guard |
| `capture` | Stores trimmed stdout for later steps |
| `changedWhen` | Classifies a successful run as always, never, output-contains, or output-not-contains |
| `report` | Names the user-managed subject and supplies changed/current or applied detail text |

Guards use the step environment. Guard and step declarations are hashed as data,
so changing a command's inputs or idempotency rule invalidates semantic sync.
Report metadata is presentation-only and excluded from the signature, so wording
changes do not reapply a target.

## Outcome

Steps run in declaration order. Capture steps are internal and do not produce
resource outcomes. A probe reports `unchanged`, a guarded reconcile step reports
`changed` or `unchanged`, and an apply step reports `applied`. A failed step
reports its subject and stops the pipeline. Runtime selection commands use
read-only output guards where available, so setting a default runtime reports a
change only when the selected version actually differed.
