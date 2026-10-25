# Document Conversion

## Conversion boundaries

| Direction | Pipeline | Contract |
|---|---|---|
| Markdown → PDF | Pandoc produces standalone HTML; a browser renders it with the bundled print stylesheet. | Local resources are embedded, HTTP requests are blocked, and PDFs are written atomically. |
| PDF → Markdown | Poppler extracts UTF-8 text. | Text is preserved; semantic Markdown structure is not inferred. |
| Input planning | One planner handles files and recursive directories. | Relative paths are preserved, nested output is excluded, and output collisions fail before conversion. |

The public shell aliases are backed by the hidden document commands described in
[usage.md](../usage.md).

## Local resource ownership

Pandoc renders HTML without fetching or embedding dependencies. The conversion
layer parses that HTML and its CSS, embeds local images, fonts, and styles, and
resolves recursive stylesheet imports relative to each containing file. Missing,
cyclic, nonlocal, or unparseable dependencies fail with a conversion diagnostic.
CSS imports and URLs, including data-encoded stylesheet imports, follow the same
local-only policy. Resource base overrides, refreshes, and `srcset` are rejected;
images use a single `src`.

Remote Markdown images remain external and are blocked by the browser's HTTP
routing rather than fetched by Pandoc. Ordinary hyperlinks remain navigable in
the output. Mermaid and MathML rendering retain their existing boundaries.

## Build coupling

The renderer uses pinned `mermaid` and `playwright-core` dependencies. The
Mermaid distribution path and the browser bundling workaround are coupled to
those pins; the build checks that the pinned renderer path still resolves before
producing a binary. A pin change is therefore a deliberate build decision, not
an incidental lockfile refresh.
