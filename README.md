# Magic ReWrite

Revise the body text of a Word document in a plain-text tool, and get the
original `.docx` back with the new wording in it.

Open a `.docx` in the browser. Magic ReWrite pulls out the body paragraphs,
without headings, captions, the table of contents, tables or the reference list,
and holds back the in-text citations. You copy that text into whatever tool
you revise with and paste the result back. It shows you a live preview, then
writes the revised paragraphs into a copy of the original file. Formatting,
styles, footnotes, tables, images and everything else in the file are left as
they were.

Everything happens in the page. The document is never uploaded, and the page
works with no network connection.

## Running it

Serve the folder with any static file server and open it in a browser:

```bash
npx serve .                   # or
python3 -m http.server 3000
```

A server is needed because the page is built from ES modules, which Chrome
and most other browsers will not load from a `file://` URL.

## Using it

**File tab.** Open a document with **Open Document**, Ctrl+O, or by dropping
it on the document pane. The left pane shows the document; the right pane shows the
text that will be revised, split into canvases, each with a copy button and a
word count. The badges above them say what was left out: headings stripped,
tables decomposed, citations held.

- **Paid / Free** sets the canvas size: at most 5,000 words (Paid, the
  default) or 1,000 (Free). Whole sections are kept together where they fit;
  a section longer than the limit is divided between paragraphs.
- **Re-extract** reads the file again, discarding edits made to the canvases.

Changing the canvas size, re-extracting or opening another document starts
the Revise tab again, since a revision pasted against the old canvases no
longer lines up with the new ones.

**Revise tab.** Paste the revised text for each canvas into the matching
canvas on the left. The preview on the right updates as you paste, replacing
only the paragraphs it can match, so a half-finished revision previews
correctly. **Download .docx** is enabled once every canvas has text, and
saves `<name>_revised.docx`. **Re-combine** merges several canvases into one
for a final read-through.

Footnotes and endnotes are shown on a separate page below the document in
both previews. mammoth, which renders the document, appends them to the end
of the body with no heading, where they read as part of the last section. The
downloaded file is not affected by this.

## What the downloaded file contains

Only the text of body paragraphs changes. For each paragraph that was matched
to a revision:

- the text runs are replaced by one run carrying the formatting of the
  paragraph's first run;
- footnote and endnote references, fields, drawings, bookmarks, comment
  anchors and tracked-change markup stay in the paragraph. References that sat
  between sentences end up after the new text, in their original order, since
  the sentences they sat between no longer exist;
- a bold `Label: text` paragraph keeps its label bold;
- citations are put back, each into the sentence it was taken from, before
  the full stop;
- a hyphen between two numbers becomes an en dash (`10–20`), and a spaced
  hyphen an em dash. Dates and other chains of numbers (`2025-08-16`, ISBNs)
  are left alone.

Headings, the table of contents, captions, tables (including nested ones)
and paragraphs that were not matched are written back byte for byte.

## How it works

The code is in `js/modules/`; `js/app.js` wires it to the page.

**Extraction** (`extractor.js`). mammoth parses the document. Paragraphs are
dropped if their style is a heading, title, TOC entry, caption, footnote or
bibliography style, if they look like a TOC line or a bare reference number,
or if they sit in a reference section. A reference section starts at a
heading such as *References*, *Bibliography* or *Works Cited* and runs to the
next heading at the same level or shallower, or to one such as *Appendix*.
Deeper headings inside it are treated as group labels within the list. Tables are
flattened column by column. The result is one string in which sections are
separated by four newlines, a paragraph after a stripped bold label by two,
and ordinary paragraphs by one.

**Citations** (`citations.js`). `(Smith 2020)`, `(OAIC 2025a)`,
`(Kennedys 2025; Rigby Cooke Lawyers 2025)` and `[1]`, `[1-3]` are removed
from the extracted text and recorded with the index of the sentence they were
in. `(Cth)`, `(see Smith 2020)`, `(Schedule 2, … 2025)` and `[2022]` are not
citations and stay in the text.

**Canvases** (`splitIntoCanvases`). Sections are packed greedily into
canvases up to the word limit. A section over the limit is cut at the
coarsest boundary that brings each piece under it. A single paragraph over
the limit stays whole.

**Matching** (`alignment.js`). The pasted text is cut at blank lines and each
piece is matched to a section of the extracted text. Exact matches first;
then every remaining pair is scored by word overlap (Jaccard similarity over
words of three or more letters, in any script) and assigned best score first,
so the order pieces are pasted in does not matter. A piece that matches
nothing but follows one that did, while that section still has unfilled
paragraphs, is attached to it. That covers a revision that gained a stray
blank line, or a section divided across two canvases. Within a
section, revised lines are paired with original paragraphs by position when
the counts agree and by word overlap when they do not.

Every lookup from a document paragraph to an extracted line goes through
`matchKey()`: citations removed, spacing collapsed, lower case. The writer
reads a paragraph's text the way mammoth does, with entities decoded and
breaks as spaces, so both sides compare the same thing.

**Writing** (`docx-writer.js`). JSZip opens the original file, each
`<w:p>` in `word/document.xml` is looked up as above, and matched paragraphs
are rewritten as described in the previous section. A paragraph that is not
one balanced `<w:p>` element, such as one containing a text box, is left
untouched rather than rewritten.

**Preview** (`preview.js`). The same matching, applied to mammoth's HTML:
text nodes are replaced and element nodes (bold, links, footnote markers) are
kept.

## Limitations

- **Heavy rewrites can mis-place citations.** A citation returns to the
  sentence with the same index. If the rewrite splits a sentence, it may land
  on the wrong clause; if it merges sentences, the merged one keeps all of
  them. Nothing is dropped, but read the citations after a heavy rewrite.
- **Very short paragraphs** (fewer than three words of three letters or
  more) may not match, and are then left as they were.
- **Languages written without spaces** (Chinese, Japanese, Thai) match poorly,
  because a whole sentence counts as one word.
- **Paragraphs holding a text box** are not revised.
- **Soft line breaks** (Shift+Enter) inside a revised paragraph are not
  kept: the new text is a single run. They are read as spaces, so the words
  either side stay apart in the extracted text.
- **Reference-manager fields.** A citation inserted by Zotero, Mendeley or
  EndNote is a field; the revised paragraph gets the citation back as plain
  text, and the field itself is left with no text in it. Refreshing fields in
  Word may then add the citation a second time.
- **Tables are never revised.** Their text is offered for context and
  written back unchanged.

## Tests

```bash
npm install
npm test                # about 200 checks, ten seconds
npm run test:browser    # the round trip in a real headless Chrome
```

- `tests/scenarios/` has twelve end-to-end scenarios, each a real `.docx`
  with the text a user would paste back and assertions on the resulting XML.
  See `tests/scenarios/README.md`.
- `tests/cases.mjs` holds cases built from small generated documents
  (`tests/helpers/docx.mjs`). `tests/app-cases.mjs` holds cases that drive the
  real page in jsdom (`tests/helpers/app.mjs`).
- Both are run twice: against this tree, and against the code as it was
  before the 2026-09-30 cleanup, fetched from git. A case marked
  `regression` must fail against that earlier code, which shows it can see
  the defect it describes. Every other case must pass on both.
- `tests/vendor.test.mjs` checks that the libraries in `vendor/` are
  byte-identical to the exactly-pinned npm packages the tests use.

## Files

```
index.html            the page
css/style.css
js/app.js             event wiring: tabs, buttons, download
js/modules/
  state.js            shared application state
  ui.js               element references and small UI helpers
  file-processor.js   open and re-extract a document
  mammoth-helpers.js  text and table values from mammoth's document tree
  extractor.js        body-text extraction, canvas splitting
  citations.js        citation stripping and restoring
  constants.js        style lists, reference-heading patterns, word limits
  alignment.js        matching revised text to extracted text
  preview.js          the live preview
  docx-writer.js      writing the revision into document.xml
  canvases.js         the canvases on both tabs
  footnotes.js        the separate footnotes page
vendor/               mammoth 1.12.0 and JSZip 3.10.1, with their licences
tests/
```

## Dependencies

| Library | Version | Licence | Used for |
| --- | --- | --- | --- |
| [mammoth](https://github.com/mwilliamson/mammoth.js) | 1.12.0 | BSD-2-Clause | reading the `.docx` into HTML and a document tree |
| [JSZip](https://stuk.github.io/jszip/) | 3.10.1 | MIT or GPLv3 | reading and rewriting the `.docx` archive |

Both are served from `vendor/`. The Nunito font is loaded from Google Fonts
when there is a connection. That is the page's only network request, and it
falls back to Segoe UI or the system sans-serif without one.

## Licence

Free for personal, non-commercial use. You may use, study and modify this
software for yourself, but you may not use it commercially, and you may not
share or publish it, in its original form or modified. See [LICENSE](LICENSE)
for the full terms.

mammoth and JSZip, in `vendor/`, keep their own licences, which are beside
them.
