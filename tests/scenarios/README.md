# Scenario suites

Twelve end-to-end scenarios for the extraction → alignment → docx-patching
pipeline, each run against the app's own modules in `js/modules/`.

Each numbered folder is a **self-contained scenario**: an `input.docx`, the
revised text a user would paste into the Revise tab, and a `run-test.mjs`
that runs the pipeline and asserts on the resulting XML. The comment at the
top of each file says what it checks and why.

## Running

From the project root:

```bash
npm install
npm test                                            # everything, including these
node --test tests/scenarios/05-lists/run-test.mjs   # one scenario
```

Every scenario writes the document it generated into its own folder
(`actual_output*.docx`, gitignored) so a failing check can be opened in Word.

## What's covered

| #   | Folder                      | What it checks                                                                                                                                                                                                                                                                                              |
| --- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 01  | `01-baseline-full-revision` | Regression guard - the original generic test, every paragraph revised in order, output diffed against the original hand-verified `expected.docx`.                                                                                                                                                           |
| 02  | `02-partial-revision`       | Only some sections revised (a user who hasn't finished pasting yet). Revised sections update; everything else stays byte-identical to the original.                                                                                                                                                         |
| 03  | `03-reordered-paragraphs`   | Revised paragraphs supplied out of document order - both a mild adjacent swap and a full reversal resolve to the correct output (see "Bugs discovered and fixed" below for the reversal case).                                                                                                              |
| 04  | `04-callout-labels`         | Bold `"Label: body"` callouts (Scope / Key insight / Error analysis / Limitations). Confirms label re-bolding works even when the user drops the label or retypes it in a different case, and that an extra blank line in the middle of one extraction block no longer drops half the revision (see below). |
| 05  | `05-lists`                  | Bulleted list items, including revisions that keep a `"- "` prefix (must be stripped, not doubled) or mistakenly use a numbered prefix (`"1. "`) on a bullet list. List formatting (`<w:numPr>`) count is checked before/after.                                                                             |
| 06  | `06-tables-untouched`       | Adversarial input: revised text shaped exactly like the document's own table dump, with altered numbers, to try to corrupt the table. Table XML is confirmed byte-identical before/after.                                                                                                                   |
| 07  | `07-special-characters`     | Revised text full of raw `&`, `<`, `>`, curly quotes, an em dash, and Unicode math symbols. Confirms output XML stays well-formed, escaping is correct (no double-escaping), and everything round-trips back to the original characters.                                                                    |
| 08  | `08-duplicate-paragraphs`   | The exact same sentence appears twice in the doc, each given a _different_ revision - confirms each occurrence keeps its own distinct revision (see "Bugs discovered and fixed" below).                                                                                                                     |
| 09  | `09-footnotes`              | All 10 footnote references in the fixture doc (some ids reused), paragraphs drastically shortened or lengthened. Confirms every footnote stays attached to the correct paragraph in the correct order.                                                                                                      |
| 10  | `10-rpr-element-order`      | A callout label run with extra formatting (custom font + size) beyond bold. Confirms `<w:b/><w:bCs/>` gets inserted in the OOXML-schema-correct position instead of corrupting run-property element order (a real cause of Word refusing to open the file - see below).                                     |
| 11  | `11-footnote-canvas`          | Footnotes are split off mammoth's HTML onto their own page, only when every item in the trailing list is a note, and links on the Revise tab's dark canvas meet 4.5:1 contrast. |
| 12  | `12-citations-and-references` | Reference sections are dropped from the extracted text, in-text citations are held and restored by sentence, and both canvas budgets are respected on a real document. |

## Bugs discovered and fixed

Building this suite surfaced three real bugs in `alignment.js` /
`docx-writer.js`, each isolated to its own minimal test case. All three are
now fixed (in both `js/modules/alignment.js` and `js/modules/docx-writer.js`
in the app source), and every check in this suite passes.

1. **Reordered input (`03`)** - `buildAlignmentMap` used to process revised
   paragraphs sequentially, letting whichever paragraph was processed
   first grab the first "good enough" block match - so a paragraph
   processed earlier (e.g. because the array was reversed) could steal a
   block away from a later paragraph that was actually the better match
   for it. Under full reversal this caused a prose paragraph to get
   mis-matched to a table-derived block. **Fix:** replaced the sequential
   greedy search with a global greedy max-weight matching - every
   (revised paragraph, extracted block) pair is scored up front, and
   assignments are made strictly in descending similarity order, so the
   strongest match always wins regardless of input order.

2. **Mid-block blank line (`04`)** - a single extraction block only ever
   got ONE revised-text match. If the user's pasted revision had an extra
   blank line splitting one block's content into two paragraphs, the
   second was silently dropped and the original text reverted. **Fix:**
   added an "orphan paragraph reattachment" pass - when a revised
   paragraph doesn't match any block on its own, but the paragraph
   immediately before it (in supplied order) matched a block that still
   has unfilled lines, the orphan gets appended as additional content for
   that same block instead of being discarded.

3. **Duplicate original text (`08`)** - `lineMapping` was keyed only by
   the _normalized original text_ of single-line blocks. When the same
   sentence appeared twice in the source doc with two different
   revisions, the second silently overwrote the first in that shared Map,
   so both occurrences ended up with the same (last-written) revision.
   **Fix:** `lineMapping` now stores an array of `{extIdx, value}`
   candidates per key (sorted by document position) instead of a single
   value, and both `findXmlIdx()` and `resolveRevised()` in
   `docx-writer.js` pick the candidate for the specific `extIdx` (or the
   first not-yet-consumed one) instead of relying on a single shared slot.

4. **Live preview stuck on original text (`04`'s golden path indirectly, root-caused outside this suite)** - `preview.js` (used by the "Insert tab" live preview, separate code path from the actual download) had its own copy of the `lineMapping` lookup logic that wasn't updated when `lineMapping`'s shape changed (see #3 above), so every replacement silently failed and the preview kept showing original text no matter what was pasted.

5. **Preview newline flattening** - `canvases.js`'s `updateRevisedPreview()` was replacing every internal `\n` with a space before matching, destroying the line structure multi-sentence blocks need for correct alignment. The download path (`app.js`) never did this, which is why a stale preview could coexist with a correct download. Fixed by matching the download path's splitting exactly (no flattening).

6. **Footnote markers polluting the preview's match text** - the biggest contributor to "preview never updates no matter what I paste." `el.textContent` on a mammoth-rendered paragraph includes the visible `[1]` footnote marker mammoth renders inline as `<sup><a href="#footnote-1">[1]</a></sup>` - text that was never part of the extracted text used to build the alignment map. Any paragraph with a footnote could therefore never match anything. Fixed by stripping footnote/endnote reference elements before computing the match key (the footnote link itself is left untouched in the DOM - only the _lookup key_ excludes it).

7. **OOXML `<w:rPr>` element ordering (likely cause of "Word experienced an error trying to open the file")** - when splitting a bold `"Label: body"` callout into a bold-label run + plain-body run, `docx-writer.js` always inserted `<w:b/>` immediately after `<w:rPr>`. The OOXML schema (`CT_RPr`) requires run-property children in a fixed order (`rStyle`, `rFonts`, `b`, `bCs`, ...); if the original run had other formatting first - a custom font, for instance - this put `<w:b/>` in a schema-invalid position. Lenient parsers (mammoth, LibreOffice, and this suite's own tests, which is why it went unnoticed) don't care, but real Word validates this order strictly and rejects the file as corrupted. Fixed with schema-order-aware insertion/removal helpers (`ensureBold` / `stripBold` in `docx-writer.js`), and covered by a new test (`10-rpr-element-order`).

None of these ever corrupted the document structurally in a way our earlier tests caught - bugs 1–3 were "wrong text ends up in the right place," bugs 4–6 were preview-only (download was already correct), and bug 7 is the one that could genuinely produce a file Word refuses to open.
