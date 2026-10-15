# Code Review — Magic ReWrite

First reviewed 2026-09-04. Remediated 2026-09-30 on branch `cleanup/2026-09-30`
(not pushed). This file is now a record of that pass; the original findings and
checklist are kept at the end.

## Corrections to the first review

The first review called this "the best-engineered web project in the archive",
said the test suite was why, and found "very little to criticise". Three parts
of that were wrong, and the praise is the reason nobody looked further.

1. **The suite could not run, and reported success.** Every one of the twelve
   suites opened its fixture with `new URL(..., import.meta.url).pathname`,
   which on Windows resolves to `E:\E:\...With%20Libraries\...`. The `%20`
   alone breaks it on any OS, because this project lives under "With
   Libraries". All twelve crashed with ENOENT before making a check, and
   `run-all.sh` printed their names and exited 0. Measured on 2026-09-30:
   `npm test` green, zero checks run.

2. **The suite passed because of what it did not cover.** It called
   `patchDocumentXml` with four arguments; the app passes five, the fifth
   being the citation index. The citation round trip, the feature the README
   leads with, was tested only as `stripCitations`/`restoreCitations` in
   isolation, never through the writer or the preview. That is where the
   worst defect was (item 1 below).

3. **"Nothing to remove … no committed build output" was not true.** Tracked
   were: a 657 KB `liveserver.exe` (a pre-fix build of the author's own
   `C/Live Server`, whose live reload never worked); twelve
   `actual_output*.docx` files that every test run rewrote; a full copy of
   `js/modules/` under `tests/auto/_shared/` that `run-all.sh` re-copied on
   every run; a `tests/manual/` directory byte-identical to scenario 01's
   fixtures; `integration-check.mjs`, which read its document from
   `/home/claude/work/Evidence/...`; and `manual_check.mjs`, which read a file
   that does not exist. There was no `.gitignore`.

The review's two P2 findings were real and are fixed (vendoring, version pins).

## What was fixed

Eleven defects, each with regression tests confirmed failing against the
original code (commit `6f06d5a`) in the same run — see "Tests" below.

1. **Cited paragraphs were never revised.** In any section of two or more
   paragraphs, a paragraph carrying an in-text citation kept its original
   wording in the download and in the preview, while the citation "round
   trip" restored citations into unrevised text. On the project's own
   reference document (scenario 12): 54 of 66 lines revised, and **0 of the
   12 cited paragraphs**. The writer looked paragraphs up by their raw text,
   which still carries the citation; the extracted line had it stripped.
   Fixed with one `matchKey()` used by writer, preview and alignment. Fixing
   it exposed a latent double restore (every citation twice), also fixed.
2. **Paragraphs containing `&`, `<` or `>`, or Word's non-breaking or soft
   hyphen, were not revised in the download.** The writer compared
   XML-escaped `<w:t>` text (`R&amp;D`) with mammoth's text (`R&D`), and did
   not see the hyphen elements mammoth reads as characters. The preview was
   unaffected for `&`, so preview and download disagreed.
3. **Word refused the downloaded file** when a revised paragraph began or
   ended with a hyperlink, tracked insertion, content control or smart tag.
   The run surgery kept "everything before the first text run" and
   "everything after the last run", dropping what lay between, so a wrapper
   lost one of its tags. It also dropped `<w:bookmarkStart>`s between runs.
   Now every text run is removed wherever it is and the new run goes where
   the first one was; everything else stays in place. A paragraph that is
   not one balanced `<w:p>` (a text box) is left untouched.
4. **Soft line breaks glued words together** in the extracted text
   ("blocksecond"). `gtxt()` tested for a `lineBreak` type mammoth does not
   have; mammoth reports `break`. Writer and preview now read breaks as
   spaces too.
5. **Non-Latin text could not be revised.** `tokenSet()` kept only
   `[a-z0-9]`, so a Cyrillic or Devanagari paragraph had no tokens and matched
   nothing unless pasted back unchanged.
6. **Nested tables were rewritten.** A table's range ended at the first
   `</w:tbl>`, i.e. an inner table's, so the outer table's later cells were
   treated as body text.
7. **Canvases exceeded their word budget.** The oversized-section fallback
   split at `\n\n`, but paragraphs within a section are joined by `\n`, so it
   split nothing; a long *first* section never reached the fallback. A 1,500
   word section became one "≤ 1,000 word" Free canvas.
8. **The Revise tab went stale.** After pasting, a Free/Paid switch or
   Re-extract on the File tab, or opening a second document, left the old
   paste canvases on screen with text the app had discarded and Download
   enabled — and Download then did nothing. Confirmed by driving the real
   page: 1 canvas holding 28,514 characters shown, 5 empty ones stored.
9. **Opening an unreadable file** set it as the current file before mammoth
   tried it, leaving the previous document's extraction under the broken
   file's name.
10. **Dates and ISBNs were rewritten as ranges**: `2025-08-16` came out as
    `2025–08–16`.
11. **Three badges were missing a space**: "headingsstripped",
    "tablesdecomposed", "citationsheld". *This changes on-screen text*; it is
    recorded in `CLEANUP-LOG.md` as such.

Also: mammoth and JSZip are vendored in `vendor/` (the page loaded mammoth
1.8.0 from cdnjs with no integrity check, and JSZip on first download), the
page runs the same mammoth (1.12.0) the tests do, and a test holds the two
byte-identical. The 114 original checks pass against 1.8.0 and 1.12.0 alike.

## Tests

`npm test` — 197 checks, about ten seconds, no browser needed. Every commit on
the branch was checked out into its own worktree and tested there.
`npm run test:browser` — 6 checks in a real headless Chrome.

- `tests/scenarios/` — the original twelve suites, now running (114 checks),
  importing `js/modules/` directly.
- `tests/cases.mjs` — 30 cases on generated documents and the reference document.
- `tests/app-cases.mjs` — 8 cases that drive `index.html` and `app.js` in
  jsdom, including a differential: the page's Download must write
  byte-for-byte the `document.xml` the module pipeline produces.
- Both case lists run twice, against this tree and against `6f06d5a` fetched
  with `git show`. **A `regression` case must fail against the original; every
  other case must pass there.** 28 regression cases (22 + 6), all failing against the
  original. This caught two of my own cases that did not test what they said
  (a content control placed where the original survived it; a soft-break
  download case the original also passed), and one fixture that failed for
  an unrelated reason.
- `tests/browser/run.mjs` — serves the project on loopback, fails every
  request to another origin, and runs open → paste → download in Chrome. The
  page needs nothing from the network; Chrome's file matches the pipeline's.

## Left alone, and why

- **No licence.** The author's decision.
- **Citations placed by sentence index.** A rewrite that splits or merges
  sentences can put a citation on the wrong clause. Documented; solving it
  needs sentence alignment, which is a design change.
- **Reference-manager fields** (Zotero, Mendeley, EndNote citations). The
  field's result text is replaced like any text and the citation restored as
  plain text, leaving an empty field; a field refresh in Word may then add it
  again. Reasoned from the surgery, not tested against Word.
- **Paragraphs holding a text box** are not revised (left byte-identical).
- **Low similarity threshold (0.08).** With a partial paste, a piece whose
  own block is already claimed can take an unrelated block. The orphan
  reattachment handles a complete paste, which is the normal case, and a test
  shows a section split across canvases comes back whole.
- **The bibliography heuristic in `skP`** and the table-cell deduplication
  (`ct.has(raw)`) can drop a body paragraph that looks like a reference entry
  or repeats a table cell. Not demonstrated to bite; not changed.
- **Phone numbers like `555-1234`** still become en-dash ranges; they cannot
  be told apart from `10-20`.
- The DOM ids `humanized*` are left as they are (UI).

## Notes for whoever is next

- Nothing has been opened in **Word**. Well-formedness is checked with xmldom
  and mammoth reads every output back, but Word validates more strictly
  (element order, which scenario 10 covers). The one check worth ten
  minutes: open a document with a hyperlink at the start of a paragraph and a
  tracked change, revise it, and open the download in Word.
- To prove a regression test, add it to `cases.mjs` or `app-cases.mjs` with
  `regression: true`; `original.test.mjs` fails if it passes on `6f06d5a`.
- `tests/helpers/app.mjs` has two jsdom workarounds (images never load;
  JSZip's `setImmediate` polyfill never fires under jsdom's `postMessage`).
  Neither is an app bug; the Chrome run shows the page works without them.
- The whole `npm test` needs full git history for the original-code halves;
  in a shallow clone they skip rather than fail.

---

## Original review (2026-09-04)

### Findings

1. The mammoth script has no subresource integrity. — **Fixed by vendoring.**
2. The application and the tests are on different mammoth versions. —
   **Fixed; pinned exactly and held identical by a test.**
3. The CDN dependency defeats offline use. — **Fixed; verified in Chrome with
   the network cut off.**
4. No way to run the suite from the project root; no CI. — **Fixed:** root
   `package.json`, `.github/workflows/test.yml`.
5. `tests/manual/` undocumented. — **Removed:** it duplicated scenario 01.
6. No `LICENSE`. — **Open:** the author's decision.

### Action checklist

- [x] **P2** Add subresource integrity to the mammoth script tag, or vendor the library.
- [x] **P2** Align the runtime and test mammoth versions; pin the test dependency exactly.
- [x] **P3** Add a root `package.json` test script and a CI workflow running the twelve suites.
- [x] **P3** Document `tests/manual/` (removed as a duplicate instead).
- [ ] **P3** Add a `LICENSE` — the author's decision.

## Licence, 2026-10-02

The author chose one licence for all of their projects: free for personal,
non-commercial use, modifiable for the user's own use, and not to be
distributed, original or modified. No standard licence says that, so `LICENSE`
is a short custom text, the same in every project apart from the year and what
it excludes. The README's licence section says the same, and `package.json`
declares `SEE LICENSE IN LICENSE`, npm's form for a licence with no SPDX
identifier. Anything above that calls the licence an open question, or calls
the project MIT, is superseded.

## CI, 2026-10-02

The existing `.github/workflows/test.yml` was checked and left unchanged: run
from a fresh clone on Ubuntu 24.04 with full history, as it asks, 197 of 197.
The 11-check browser suite is not in it; adding a second job with `npm run
test:browser`, as the other web projects now have, would cover it.

## Scroll sync removed, 2026-10-04

At the author's request, the two panes on each tab now scroll independently.
They used to be linked by `js/modules/scroll-sync.js`, which moved the other
pane to the matching paragraph. That module is deleted, along with everything
that existed only to feed it: the `data-blk` attributes stamped by
`preview.js` (including the whole of `tagOriginalHtmlBlocks`, run on every
open and re-extract), `entryExtIdx` from `buildAlignmentMap` and
`buildRevisedHtml`, and `state.revisedEntryExtIdx`. None of these affected the
preview's text or the downloaded file. The browser suite gains a check that
scrolling one pane leaves the other where it was on both tabs. It fails
against the old code (the extracted text moved 210px) and passes now. Unit
tests: 197 of 197. Browser: 7 of 7.
