"use strict";

/* ═══════════════════════════════════════════════
     EXTRACTION CONSTANTS
  ═══════════════════════════════════════════════ */
export const SKIP_R = [
  "Title", "Subtitle",
  "Heading 1", "Heading 2", "Heading 3", "Heading 4", "Heading 5",
  "Heading 6", "Heading 7", "Heading 8", "Heading 9",
  "TOC 1", "TOC 2", "TOC 3", "TOC 4", "TOC 5",
  "TOC 6", "TOC 7", "TOC 8", "TOC 9", "TOC Heading",
  "Bibliography", "References", "Reference", "Source Text",
  "Footnote Text", "Endnote Text", "Caption",
];
export const SECT_R = ["Heading 1", "Heading 2", "Heading 3"];
export const BUL_R  = ["List Bullet", "List Bullet 2", "List Bullet 3", "List Bullet 4", "List Bullet 5"];
export const NUM_R  = ["List Number", "List Number 2", "List Number 3", "List Number 4", "List Number 5"];

export const nm = (s) => (s || "").trim().toLowerCase();

export const SKIP = new Set(SKIP_R.map(nm));
export const SECT = new Set(SECT_R.map(nm));
export const BUL  = new Set(BUL_R.map(nm));
export const NUM  = new Set(NUM_R.map(nm));

/* In-text citation handling lives in citations.js. Re-exported here so the
   existing importers of `sc` / `CITAT` keep working unchanged. */
export { CITAT, sc, stripCitations, restoreCitations } from "./citations.js";

/* ── Reference sections ─────────────────────────────────────────────────
   Headings that open a reference list. Everything from one of these to the
   end of its section is bibliography, not body text: it must not be handed
   to a rewriter, and must not be counted in the word budget. */
export const REF_HEADING_RE =
  /^\s*(?:\d+[.)]?\s*)?(references?|bibliography|works\s+cited|reference\s+list|list\s+of\s+references|sources)\s*:?\s*$/i;

/** Headings that legitimately follow a reference list and so end it. */
export const POST_REF_HEADING_RE =
  /^\s*(?:\d+[.)]?\s*)?(appendix|appendices|annex|annexure|glossary|acknowledge?ments?|declaration|about\s+the\s+author)\b/i;

/** Heading level from a mammoth style name: "Heading 2" → 2, "Title" → 0. */
export function headingLevel(styleName) {
  const s = nm(styleName);
  const m = /^heading\s*(\d)$/.exec(s);
  if (m) return parseInt(m[1], 10);
  if (s === "title") return 0;
  return null;
}

export const FREE_WORD_LIMIT = 1000;
export const PAID_WORD_LIMIT = 5000;
