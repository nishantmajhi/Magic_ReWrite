"use strict";

import {
  nm,
  SKIP,
  SECT,
  BUL,
  NUM,
  sc,
  FREE_WORD_LIMIT,
  REF_HEADING_RE,
  POST_REF_HEADING_RE,
  headingLevel,
} from "./constants.js";
import { stripCitations, buildCitationIndex } from "./citations.js";

/* ═══════════════════════════════════════════════
     EXTRACTION LOGIC
  ═══════════════════════════════════════════════ */

/**
 * Detect heading-like paragraphs that should be stripped or their
 * label extracted.  Returns:
 *   { skip: true }        - drop entirely
 *   { strip: bodyText }   - keep only the body after "Label: "
 *   null                  - treat as normal paragraph
 */
function iHead(bF, raw, isList) {
  const t = raw.trim();
  if (!t) return null;
  // Section-label-only paragraphs (e.g. "Results:") - only skip when explicitly bold
  if (
    bF === true &&
    t.endsWith(":") &&
    /^[A-Z]/.test(t) &&
    !/[.!?]/.test(t.slice(0, -1))
  )
    return { skip: true };
  // "Label: body" callout paragraphs - gate on !isList to exclude list items
  if (!isList) {
    const m = t.match(/^([A-Z][A-Za-z\s]{1,60}):\s+([A-Z].*)$/s);
    if (m) {
      const l = m[1].trim(),
        r = m[2].trim();
      if (l.length <= 60 && !/[.!?,;]/.test(l) && r.length > 0)
        return { strip: r };
    }
  }
  return null;
}

/** Flatten a table's cell values into plain text, column by column. */
function dTable(v) {
  if (!v || !v.length || !v[0] || !v[0].length) return "";
  const nc = v[0].length,
    cols = [];
  for (let c = 0; c < nc; c++) {
    const cells = v
      .map((row) =>
        sc(row[c] || "")
          .replace(/\s{2,}/g, " ")
          .trim(),
      )
      .filter(Boolean);
    if (cells.length) cols.push(cells.join("\n"));
  }
  return cols.join("\n\n");
}

/** Returns true if the paragraph should be skipped during extraction. */
function skP(st, raw, ct) {
  if (!raw) return true;
  if (SKIP.has(nm(st))) return true;
  if (/\t\d+$/.test(raw)) return true; // TOC page-number lines
  if (/^\[\d[\d,\-\s]*\]$/.test(raw)) return true; // bare reference tags
  if (ct.has(raw)) return true; // text already in a table cell
  if (
    /^(\d+\.\s|[A-Z][a-z]+,\s[A-Z]\.\s)/.test(raw) &&
    /\(\d{4}\)/.test(raw) &&
    raw.length > 80
  )
    return true; // bibliography entries
  return false;
}

/**
 * Main extraction pass.
 *
 * @param {Array} elems  - flat list of paragraph/table descriptors from mammoth
 * @returns {{ out: string, pills: Array, nW: number, calloutKeys: Map }}
 */
export function processElements(elems) {
  // Build a set of all table-cell text so we can skip duplicated prose
  const ct = new Set();
  elems
    .filter((e) => e.type === "t")
    .forEach((t) =>
      t.v.forEach((row) =>
        row.forEach((c) => {
          if (c) ct.add(c.trim());
        }),
      ),
    );

  // Numbered-list counter: tracks the current count per (numId, level) pair
  const cn = new Map();
  function nxt(ni, lv) {
    const k = `${ni}:${lv}`,
      c = (cn.get(k) || 0) + 1;
    cn.set(k, c);
    // Reset deeper levels whenever a shallower one advances
    for (const [j] of cn) {
      const [ji, jl] = j.split(":").map(Number);
      if (ji === ni && jl > lv) cn.delete(j);
    }
    return c;
  }
  function pfx(e) {
    const s = nm(e.st);
    if (BUL.has(s)) return "- ";
    if (NUM.has(s)) return `${nxt(e.ni ?? 0, e.lv)}. `;
    return "- ";
  }

  const bl = []; // output block list: { k: "x"|"t", ... }
  let ps = false; // previous element was a section heading
  let pi = false; // previous element was a skipped/label-only heading

  // Reference-section tracking. Style names alone can't identify a
  // bibliography: the heading is usually styled, but the entries beneath it
  // are almost always plain Normal paragraphs, so they read as body text and
  // get handed to the rewriter along with the essay. Once a reference
  // heading is seen, everything up to the end of its section is dropped.
  let inRefs = false;
  let refLevel = null;

  for (const e of elems) {
    if (e.type === "t") {
      if (inRefs) continue;
      bl.push({ k: "t", v: e.v });
      continue;
    }
    const { st, raw, bold, isList } = e,
      s = nm(st);
    const lvl = headingLevel(st);
    const headingText = (raw || "").trim();

    if (inRefs) {
      // A heading at the reference heading's level or shallower ends the
      // section - as does a heading that names a section which genuinely
      // follows a bibliography, whatever its level. Anything deeper is a
      // group label inside the list ("Legislation and Cases") and stays out.
      const endsSection =
        (lvl != null && refLevel != null && lvl <= refLevel) ||
        POST_REF_HEADING_RE.test(headingText);
      if (endsSection && !REF_HEADING_RE.test(headingText)) {
        inRefs = false;
        refLevel = null;
        // fall through and process this heading normally
      } else {
        continue;
      }
    }

    if (lvl != null && REF_HEADING_RE.test(headingText)) {
      inRefs = true;
      refLevel = lvl;
      continue;
    }

    if (SECT.has(s)) {
      ps = true;
      pi = false;
      continue;
    }
    if (skP(st, raw, ct)) continue;

    const hr = iHead(bold, raw, isList);
    if (hr) {
      if (hr.skip) {
        pi = true;
        continue;
      }
      if (hr.strip) {
        const { text: r, cites } = stripCitations(hr.strip);
        if (r) {
          const label =
            raw
              .trim()
              .match(/^([A-Z][A-Za-z\s]{1,60}):/)?.[1]
              ?.trim() ?? "";
          bl.push({
            k: "x",
            text: label ? `${label}: ${r}` : r,
            label,
            body: r,
            isList: false,
            ns: ps,
            im: true,
            cites,
          });
          ps = false;
          pi = false;
        } else {
          pi = true;
        }
        continue;
      }
    }

    const { text: clean, cites } = stripCitations(raw);
    if (!clean) continue;
    const ns = ps,
      im = !ps && pi;
    ps = false;
    pi = false;
    bl.push({
      k: "x",
      text: isList ? pfx(e) + clean : clean,
      isList,
      ns,
      im,
      cites,
    });
  }

  // Assemble output string
  let out = "";
  const as = (c) => {
    if (!c) return;
    out = out ? out + "\n\n\n\n" + c : c;
  };
  for (const b of bl) {
    if (b.k === "t") {
      const d = dTable(b.v);
      if (d) as(d);
      continue;
    }
    if (!out) out = b.text;
    else if (b.ns) out += "\n\n\n\n" + b.text;
    else if (b.im) out += "\n\n" + b.text;
    else out += "\n" + b.text;
  }

  // calloutKeys: Map from normStr(text) → original-cased text
  // Used by buildAlignmentMap to identify iHead-strip paragraphs precisely
  const calloutKeys = new Map(
    bl
      .filter((b) => b.k === "x" && b.label)
      .map((b) => {
        const original = b.text.replace(/\s+/g, " ").trim();
        return [original.toLowerCase(), original];
      }),
  );

  // citationIndex: normalised line text → citations stripped from it, so the
  // revised text can have them put back where they belong.
  const citationIndex = buildCitationIndex(
    bl.filter((b) => b.k === "x" && b.cites && b.cites.length),
  );

  const tx = bl.filter((b) => b.k === "x");
  const nP = tx.length,
    nL = tx.filter((b) => b.isList).length,
    nS = tx.filter((b) => b.ns).length,
    nT = bl.filter((b) => b.k === "t").length,
    nC = tx.reduce((n, b) => n + (b.cites ? b.cites.length : 0), 0),
    nW = out.split(/\s+/).filter(Boolean).length;

  const pills = [
    { label: `${nP} paragraph${nP !== 1 ? "s" : ""}`, cls: "bd-p" },
    nL > 0 && { label: `${nL} list item${nL !== 1 ? "s" : ""}`, cls: "bd-l" },
    nS > 0 && {
      label: `${nS} heading${nS !== 1 ? "s" : ""} stripped`,
      cls: "bd-s",
    },
    nT > 0 && {
      label: `${nT} table${nT !== 1 ? "s" : ""} decomposed`,
      cls: "bd-t",
    },
    nC > 0 && {
      label: `${nC} citation${nC !== 1 ? "s" : ""} held`,
      cls: "bd-c",
    },
  ].filter(Boolean);

  return { out, pills, nW, calloutKeys, citationIndex };
}

/* ═══════════════════════════════════════════════
     SECTION-AWARE CANVAS SPLITTING  (budget per canvas)
  ═══════════════════════════════════════════════ */

// The extractor's boundaries, coarsest first: section, paragraph group
// (after a stripped label), paragraph.
const BOUNDARIES = ["\n\n\n\n", "\n\n", "\n"];

const wordCount = (t) => t.split(/\s+/).filter(Boolean).length;

/**
 * Cut text into pieces of at most `limit` words, at the coarsest boundary
 * that gets them under it. Each piece records the separator that preceded
 * it; the first piece of anything that had to be cut starts a new canvas.
 * A single paragraph over the limit stays whole - there is no boundary
 * left to cut at without cutting a paragraph.
 */
function pieces(text, limit, level = 0) {
  const out = [];
  const parts = text.split(BOUNDARIES[level]);
  parts.forEach((part, i) => {
    const sep = i === 0 ? "" : BOUNDARIES[level];
    const wc = wordCount(part);
    if (wc <= limit || level === BOUNDARIES.length - 1) {
      out.push({ text: part, wc, sep });
      return;
    }
    const sub = pieces(part, limit, level + 1);
    sub[0].sep = sep;
    sub[0].fresh = true;
    out.push(...sub);
  });
  return out;
}

/**
 * Split fullText into canvases of at most `limit` words. Whole sections are
 * packed together where they fit; a section over the limit gets canvases of
 * its own, divided between paragraphs.
 *
 * The fallback used to divide only at "\n\n", but paragraphs within a
 * section are joined by a single "\n", so a long section went into one
 * canvas far over the limit - as did any long *first* section, which never
 * reached the fallback at all.
 */
export function splitIntoCanvases(fullText, limit = FREE_WORD_LIMIT) {
  if (!fullText) return [];
  const canvases = [];
  let current = "",
    currentWc = 0;
  for (const p of pieces(fullText, limit)) {
    if (current && (p.fresh || currentWc + p.wc > limit)) {
      canvases.push(current);
      current = "";
      currentWc = 0;
    }
    current = current ? current + p.sep + p.text : p.text;
    currentWc += p.wc;
  }
  if (current) canvases.push(current);
  return canvases;
}
