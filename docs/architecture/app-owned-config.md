# App-Owned Configuration

`declaredKeys` applies when an application rewrites a configuration file at
runtime. mev owns only the keys declared by the embedded asset; the application
or user owns every other key.

## Ownership contract

| Destination value | Owner | Rule |
|---|---|---|
| Declared key | mev | Declared value wins; nested mappings merge recursively. |
| Host-only key | Application or user | Preserved unchanged. |
| Declared scalar or array | mev | Replaces the host value at that path. |
| Parsed document | Format and application | Structural equality decides whether a write is needed. |

The destination is a regular file, not a link into the deploy store. A link would
route application writes into role state and let a later deploy erase them.

## Formats

| Format | Write behavior |
|---|---|
| TOML or JSON | Serialize the merged document. |
| JSONC | Edit declared paths in the host text so comments and formatting survive. |

The activation declares the format; it is not inferred from the asset filename.
Declared documents reject prototype-reassigning keys at every depth.

## Deploy boundary

1. Before deploy, materialize every declared destination that is a symlink, even
   when its parsed values already match.
2. Deploy the role without allowing replacement to erase the host document.
3. Merge declared values and atomically replace the destination only when the
   structural values differ.

The activation kind owns this protection, so targets do not need duplicate
preservation hooks.

## Sources of truth

| Responsibility | Authority |
|---|---|
| Activation and format | `src/provisioning/activation/declared-keys.ts` |
| Merge, equality, and unsafe keys | `src/host/declared-merge.ts` |
| Preservation order | `src/provisioning/run.ts` |
| Boundary tests | `tests/provisioning/declared-keys.test.ts` |
