# Document Conversion

## Conversion boundaries

| Direction | Pipeline | Contract |
|---|---|---|
| Markdown → PDF | Pandoc produces standalone HTML; a browser renders it with the bundled print stylesheet. | Local resources are embedded, HTTP requests are blocked, and PDFs are written atomically. |
| PDF → Markdown | Poppler extracts UTF-8 text. | Text is preserved; semantic Markdown structure is not inferred. |
| Input planning | One planner handles files and recursive directories. | Relative paths are preserved, nested output is excluded, and output collisions fail before conversion. |

The public shell aliases are backed by the hidden document commands described in
[usage.md](../usage.md).

## Build coupling

The renderer uses pinned `mermaid` and `playwright-core` dependencies. The
Mermaid distribution path and the browser bundling workaround are coupled to
those pins; the build checks that the pinned renderer path still resolves before
producing a binary. A pin change is therefore a deliberate build decision, not
an incidental lockfile refresh.
