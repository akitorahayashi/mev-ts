---
name: toon
description: Use the TOON CLI whenever a task inspects or produces JSON-compatible structured data such as JSON files, API responses, database rows, search results, and structured logs. This skill applies before that data enters agent context or is authored by the agent.
---

# TOON

## Purpose

TOON is a temporary, lossless representation of the JSON data model for reducing the tokens required to read or produce structured data.

JSON remains the canonical interchange and file format unless the task explicitly requires TOON.

## Input Normalization

TOON accepts one JSON value rather than newline-delimited JSON (NDJSON/JSONL), so NDJSON is slurped into an array before encoding:

```sh
jq -s '.' events.ndjson | toon
```

Inputs are reduced to the required rows and fields before encoding when the task needs only part of the data:

```sh
jq '{items: [.items[] | {id, name, status}]}' response.json | toon
```

## Reading Structured Data

The workflow reads the CLI's TOON output instead of first reading the source JSON into agent context.

```sh
toon large-response.json
curl -fsSL https://api.example.com/items | toon
```

Converted data that must persist during the task is written under a system temporary directory owned by the current command sequence:

```sh
scratch="$(mktemp -d -t toon.XXXXXX)"
cleanup() {
  status=$?
  rm -rf "$scratch"
  exit "$status"
}
trap cleanup EXIT
toon large-response.json --stats -o "$scratch/large-response.toon"
```

The complete source JSON and its TOON representation are not both read unless comparison is required by the task.

## Producing Structured Data

JSON-compatible output is authored as TOON and decoded with strict validation into a temporary file. When the final JSON file must be replaced atomically, the temporary output is created in an exclusive sibling directory next to the final path:

```sh
final="generated.json"
parent="$(dirname "$final")"
name="$(basename "$final")"
staging="$(mktemp -d "$parent/.${name}.XXXXXX")"
output="$staging/file"
cleanup() {
  status=$?
  rm -rf "$staging"
  exit "$status"
}
trap cleanup EXIT
toon --decode -o "$output" < generated.toon
```

For stdin, decode direction is specified explicitly:

```sh
toon --decode -o "$output" < generated.toon
```

The decoded JSON syntax is validated:

```sh
jq empty "$output"
```

`jq empty` proves only that the output is valid JSON. Task-specific checks for required values, counts, and schema are run before moving it.

The output is moved to the required path only after all validation succeeds:

```sh
mv "$output" "$final"
```

The generated JSON is the deliverable unless the task explicitly requests TOON.

## Validation

The `toon` command uses strict decoding by default. Strict decoding validates array counts, indentation, headers, and escaping.

Agent-authored TOON is decoded before use as JSON. A decode failure means the TOON must be corrected.

Decoding does not target the final output path directly. The CLI can leave partial JSON output when strict decoding fails. A new temporary output is used for each decode, and it is moved to the final path only after decode and JSON validation succeed.

`--no-strict` is not used to accept malformed agent-authored TOON. Missing CLI availability or conversion failures are surfaced instead of silently falling back.

## Required Syntax

Objects use `key: value`, and nesting uses two-space indentation:

```toon
user:
  id: 1
  name: Alice
  active: true
```

Primitive arrays declare their element count:

```toon
tags[3]: rust,cli,macos
```

Uniform arrays of objects declare the row count and field order once:

```toon
users[2]{id,name,active}:
  1,Alice,true
  2,Bob,false
```

`[N]` is the array element count. `{fields}` defines the field order for every following row.

Quote strings that could be interpreted as another type or contain structural characters:

```toon
version: "123"
enabled: "true"
note: "hello, world"
```

Rely on strict decoding rather than manually reasoning about uncommon syntax and escaping cases.
