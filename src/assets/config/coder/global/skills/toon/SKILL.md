---
name: toon
description: Use the TOON CLI whenever a task inspects JSON-compatible structured data such as JSON files, API responses, database rows, search results, and structured logs. This skill applies before that data enters agent context.
---

# TOON

## Purpose

TOON is a temporary, lossless representation of the JSON data model for reducing the tokens required to read structured data.

JSON remains the canonical file and interchange format. TOON is used only as a reading surface for inspection.

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

## Validation

The `toon` command uses strict decoding by default. Strict decoding validates array counts, indentation, headers, and escaping, so malformed TOON input from upstream tools is surfaced immediately.

`--no-strict` is not used to accept malformed TOON. Missing CLI availability or conversion failures are surfaced instead of silently falling back.

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

These rules matter when reading existing TOON output or interpreting examples. Do not introduce a TOON authoring step when the task can stay in JSON.
