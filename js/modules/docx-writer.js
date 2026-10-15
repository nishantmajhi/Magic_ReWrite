"use strict";

import { tokenSet, tokenSimilarity, buildAlignmentMap, matchKey } from "./alignment.js";

/* ═══════════════════════════════════════════════
     DOCX WRITER
     Footnote-aware: preserves <w:footnoteReference>
     and other special runs while replacing text runs.
  ═══════════════════════════════════════════════ */

/** Dynamically load an external script (idempotent). */
export function loadScript(src) {
  return new Promise((res, rej) => {
    if (document.querySelector(`script[src="${src}"]`)) {
      res();
      return;
    }
    const s = document.createElement("script");
    s.src = src;
    s.onload = res;
    s.onerror = rej;
    document.head.appendChild(s);
  });
}

/** Escape special XML characters. */
function xmlEsc(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const XML_ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function xmlUnesc(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] !== "#") return XML_ENTITIES[e] ?? m;
    const hex = e[1] === "x" || e[1] === "X";
    return String.fromCodePoint(parseInt(e.slice(hex ? 2 : 1), hex ? 16 : 10));
  });
}

const PARA_TEXT_RE =
  /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:(noBreakHyphen|softHyphen|br)\b[^>]*\/>/g;
const PARA_TEXT_ELEMENTS = { noBreakHyphen: "‑", softHyphen: "­", br: " " };

/**
 * A paragraph's text as mammoth reads it, which is the text the extracted
 * lines were made from. <w:t> content is still XML-escaped in the file -
 * "R&amp;D" where mammoth saw "R&D" - and the two hyphen elements are text
 * to mammoth but invisible to a <w:t> scan. Either difference was enough
 * for a paragraph to match nothing and keep its original wording. A break
 * is a space, as it is in gtxt().
 */
function paragraphText(paraBlock) {
  let text = "";
  let m;
  PARA_TEXT_RE.lastIndex = 0;
  while ((m = PARA_TEXT_RE.exec(paraBlock)) !== null)
    text += m[1] !== undefined ? xmlUnesc(m[1]) : PARA_TEXT_ELEMENTS[m[2]];
  return text;
}

// Writing tools commonly hand back dashes as a plain hyphen, but the
// correct typographic character depends on what the hyphen is doing:
//   - A NUMERIC RANGE ("3 - 5 seconds", "10-20 items") should become an
//     en dash with no surrounding spaces: "3\u20135 seconds" - this is the
//     convention Word's own AutoCorrect and most style guides use.
//   - A PARENTHETICAL ASIDE ("here - including scaling - should") should
//     become an em dash with spaces kept: "here \u2014 including scaling
//     \u2014 should".
// The numeric-range check runs first since it's the more specific case;
// whatever spaced hyphens are left after that are asides, not ranges.
// Compound words ("encoder-decoder") and dashes already typed correctly
// are untouched either way, since neither pattern requires an unspaced
// non-numeric hyphen. Neither are chains of three or more numbers - an
// ISO date "2025-08-16", an ISBN - which are identifiers, not ranges; the
// range rule used to rewrite every hyphen in them.
function normalizeTypography(s) {
  return s
    .replace(/(?<![\d-])(\d+)\s*-\s*(\d+)(?![-\d])/g, "$1\u2013$2")
    .replace(/ - /g, " \u2014 ");
}

// OOXML's CT_RPr schema requires run-property children in a fixed order
// (ECMA-376). Only the elements that can legitimately precede <w:b>/<w:bCs>
// matter here - everything else is safe to leave after. Word validates
// this order strictly on load; inserting <w:b/> in the wrong position
// (e.g. before an existing <w:rFonts>) produces a file Word reports as
// corrupted, even though lenient parsers (mammoth, LibreOffice) don't mind.
const RPR_LEADING_TAGS = new Set(["w:ins", "w:del", "w:rStyle", "w:rFonts"]);

/** Insert <w:b/><w:bCs/> into an existing <w:rPr>...</w:rPr> block at the
 *  schema-correct position (after rStyle/rFonts if present, before
 *  everything else), or build a fresh minimal one if rPrBlock is empty. */
function ensureBold(rPrBlock) {
  if (!rPrBlock) return "<w:rPr><w:b/><w:bCs/></w:rPr>";
  if (/<w:b[\s\/]/.test(rPrBlock)) return rPrBlock; // already bold
  const inner = rPrBlock.replace(/^<w:rPr[^>]*>/, "").replace(/<\/w:rPr>$/, "");
  const children =
    inner.match(/<w:[a-zA-Z]+(?:\s[^>]*)?(?:\/>|>[\s\S]*?<\/w:[a-zA-Z]+>)/g) ||
    [];
  let insertAt = 0;
  for (let i = 0; i < children.length; i++) {
    const tagM = children[i].match(/^<(w:[a-zA-Z]+)/);
    if (tagM && RPR_LEADING_TAGS.has(tagM[1])) insertAt = i + 1;
    else break;
  }
  children.splice(insertAt, 0, "<w:b/>", "<w:bCs/>");
  return "<w:rPr>" + children.join("") + "</w:rPr>";
}

/** Remove any <w:b>/<w:bCs> elements (self-closing, with attributes, or
 *  with explicit open/close tags) from an rPr block. */
function stripBold(rPrBlock) {
  if (!rPrBlock) return "";
  return rPrBlock
    .replace(/<w:b(?:\s[^>]*)?\/>/g, "")
    .replace(/<w:b(?:\s[^>]*)?>[\s\S]*?<\/w:b>/g, "")
    .replace(/<w:bCs(?:\s[^>]*)?\/>/g, "")
    .replace(/<w:bCs(?:\s[^>]*)?>[\s\S]*?<\/w:bCs>/g, "")
    .replace(/<w:rPr>\s*<\/w:rPr>/, "");
}

const TAG_RE = /<(\/?)([A-Za-z][\w.-]*(?::[\w.-]+)?)\b[^>]*?(\/?)>/g;

/**
 * Locate every run in a paragraph, and for each the start of the paragraph's
 * direct child that holds it - the run itself, or the <w:hyperlink>,
 * <w:ins>, <w:sdt> or other wrapper around it.
 *
 * Returns null unless `paraBlock` is exactly one balanced <w:p> element. The
 * paragraph regex below is lazy, so a paragraph containing a text box ends
 * at the text box's own </w:p>; such a fragment is left alone rather than
 * rewritten into something Word cannot open.
 */
function scanRuns(paraBlock) {
  const stack = [];
  const runs = [];
  let topStart = 0;
  TAG_RE.lastIndex = 0;
  let m;
  while ((m = TAG_RE.exec(paraBlock)) !== null) {
    const [tag, closing, name, selfClosing] = m;
    const end = m.index + tag.length;
    if (closing) {
      const open = stack.pop();
      if (!open || open.name !== name) return null;
      if (name === "w:r")
        runs.push({ start: open.start, end, topStart: open.topStart, direct: stack.length === 1 });
      if (!stack.length && end !== paraBlock.length) return null;
    } else {
      if (stack.length === 1) topStart = m.index;
      if (!stack.length && name !== "w:p") return null;
      if (!selfClosing) stack.push({ name, start: m.index, topStart });
    }
  }
  if (stack.length) return null;
  for (const r of runs) r.xml = paraBlock.slice(r.start, r.end);
  return runs;
}

/**
 * Perform XML surgery on word/document.xml: replace paragraph text runs with
 * revised replacements while preserving footnotes, rPr formatting, and
 * special runs (bookmarks, proofErr, etc.).
 *
 * @param {string} rawXml          - raw XML string from the docx zip
 * @param {string} curExtracted    - full extracted text (ground truth)
 * @param {Array}  revisedParas      - revised paragraph strings
 * @param {Map}    curCalloutKeys  - from processElements
 * @returns {string}               - patched XML string
 */
export function patchDocumentXml(
  rawXml,
  curExtracted,
  revisedParas,
  curCalloutKeys,
  citationIndex = new Map(),
) {
  const { extBlocks, mapping, lineMapping, calloutMap } = buildAlignmentMap(
    curExtracted,
    revisedParas,
    curCalloutKeys,
    citationIndex,
  );

  // extBlocks here is rawExtBlocks (newlines preserved)
  const rawExtBlocks = extBlocks;
  const normStr = (t) => t.replace(/\s+/g, " ").trim().toLowerCase();
  const extNorm = extBlocks.map(normStr);
  const usedXml = new Set();

  /* ── Table range pre-scan ─────────────────────────────────────────── */
  // Outermost tables only, matched by nesting depth. Taking the first
  // </w:tbl> after each <w:tbl> ended an outer table at its inner table's
  // close, and the outer table's later cells were then rewritten as body text.
  const tableRanges = [];
  {
    const tblRe = /<w:tbl[ >]|<\/w:tbl>/g;
    let m,
      depth = 0,
      start = 0;
    while ((m = tblRe.exec(rawXml)) !== null) {
      if (m[0] !== "</w:tbl>") {
        if (depth++ === 0) start = m.index;
      } else if (depth > 0 && --depth === 0) {
        tableRanges.push([start, m.index + m[0].length]);
      }
    }
  }
  function isInTable(offset) {
    for (const [s, e] of tableRanges)
      if (offset >= s && offset < e) return true;
    return false;
  }

  /* ── findXmlIdx ───────────────────────────────────────────────────── */
  function findXmlIdx(rawText) {
    const en = matchKey(rawText);
    if (!en) return -1;

    // Pass 0: lineMapping hit - return the owning extBlock index. When the
    // same original text appears in more than one block, lineMapping now
    // stores one candidate {extIdx, value} per occurrence (sorted by
    // document position); pick the first one not already consumed by an
    // earlier physical paragraph in this document-order scan.
    if (lineMapping.has(en)) {
      const candidates = lineMapping.get(en);
      for (const c of candidates) {
        if (!usedXml.has(c.extIdx)) return c.extIdx;
      }
      if (candidates.length) return candidates[0].extIdx;
    }

    // Pass 1: exact match (unused first, then any)
    for (let i = 0; i < extNorm.length; i++)
      if (!usedXml.has(i) && extNorm[i] === en) return i;
    for (let i = 0; i < extNorm.length; i++) if (extNorm[i] === en) return i;

    // Pass 2: line-in-block containment
    for (let i = 0; i < rawExtBlocks.length; i++) {
      if (usedXml.has(i)) continue;
      const blockLines = rawExtBlocks[i]
        .split(/\n/)
        .map((l) => normStr(l))
        .filter(Boolean);
      for (const bl of blockLines) {
        if (bl === en) return i;
        const blStripped = bl.replace(/^(-\s+|\d+\.\s+)/, "").trim();
        if (blStripped === en) return i;
      }
      if (extNorm[i].startsWith(en) || en.startsWith(extNorm[i])) return i;
    }

    // Pass 3: token similarity
    const hSet = tokenSet(en);
    let bi = -1,
      bs = 0;
    for (let i = 0; i < extNorm.length; i++) {
      if (usedXml.has(i)) continue;
      const sim = tokenSimilarity(hSet, tokenSet(extBlocks[i]));
      if (sim > bs) {
        bs = sim;
        bi = i;
      }
    }
    return bs >= 0.35 ? bi : -1;
  }

  /* ── resolveRevised ─────────────────────────────────────────────── */
  // Para-level lineMapping first; block-level only for single-line blocks.
  function resolveRevised(rawText, extIdx) {
    const lineKey = matchKey(rawText);
    if (lineMapping.has(lineKey)) {
      const candidates = lineMapping.get(lineKey);
      const exact = candidates.find((c) => c.extIdx === extIdx);
      if (exact) return exact.value;
      if (candidates.length) return candidates[0].value;
    }
    if (!mapping.has(extIdx)) return null;
    const blockLines = rawExtBlocks[extIdx]
      .split(/\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (blockLines.length === 1) return mapping.get(extIdx);
    return null;
  }

  /* ── Paragraph replacement ────────────────────────────────────────── */
  return rawXml.replace(
    /(<w:p[ >][\s\S]*?<\/w:p>)/g,
    function (paraBlock, _p1, offset) {
      if (isInTable(offset)) return paraBlock;

      const styleM = paraBlock.match(/<w:pStyle\s+w:val="([^"]+)"/);
      if (
        styleM &&
        /^(heading|Heading|title|Title|TOC|toc|Caption|caption|Subtitle|subtitle)/i.test(
          styleM[1],
        )
      )
        return paraBlock;

      const plain = paragraphText(paraBlock).trim();
      if (!plain) return paraBlock;

      const extIdx = findXmlIdx(plain);
      if (extIdx < 0) return paraBlock;
      usedXml.add(extIdx);

      if (!mapping.has(extIdx) && !lineMapping.has(matchKey(plain)))
        return paraBlock;
      const resolved = resolveRevised(plain, extIdx);
      if (!resolved) return paraBlock;

      // Strip list prefix added by processElements for list paragraphs
      const isListPara = /<w:numPr>/.test(paraBlock);
      const resolvedClean = normalizeTypography(
        isListPara
          ? resolved.replace(/^(-\s+|\d+\.\s+)/, "").trim()
          : resolved,
      );
      const newText = xmlEsc(resolvedClean);

      // Footnote-aware run surgery. Every run carrying text is removed and
      // the revised text goes in once, where the first of them was. Runs
      // without text (footnote and endnote references, breaks, fields,
      // drawings) and everything that is not a run (bookmarks, comment
      // ranges, the tags of a hyperlink or tracked change) stay where they
      // are, so every tag keeps its partner.
      const runs = scanRuns(paraBlock);
      if (!runs) return paraBlock;
      const textRuns = runs.filter((r) => /<w:t[\s>]/.test(r.xml));
      if (!textRuns.length) return paraBlock;

      const firstTR = textRuns[0];
      // Formatting comes from a run directly in the paragraph where there is
      // one, so a paragraph that opens with a link does not turn into one
      // long link-styled run.
      const styleRun = textRuns.find((r) => r.direct) || firstTR;
      const rPrMatch = styleRun.xml.match(/<w:rPr[\s\S]*?<\/w:rPr>/);
      const rPrBlock = rPrMatch ? rPrMatch[0] : "";

      // Callout paragraphs need two runs: bold label + plain body
      const calloutLabel = calloutMap.get(matchKey(plain));
      let newRuns;
      if (calloutLabel) {
        const boldRPr = ensureBold(rPrBlock);
        const plainRPr = stripBold(rPrBlock);
        const labelText = xmlEsc(calloutLabel + ": ");
        const bodyText = xmlEsc(
          resolvedClean.replace(
            new RegExp(
              "^" +
                calloutLabel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") +
                ":\\s*",
              "i",
            ),
            "",
          ),
        );
        newRuns =
          `<w:r>${boldRPr}<w:t xml:space="preserve">${labelText}</w:t></w:r>` +
          (plainRPr
            ? `<w:r>${plainRPr}<w:t xml:space="preserve">${bodyText}</w:t></w:r>`
            : `<w:r><w:t xml:space="preserve">${bodyText}</w:t></w:r>`);
      } else {
        newRuns = `<w:r>${rPrBlock}<w:t xml:space="preserve">${newText}</w:t></w:r>`;
      }

      // No text run can start before firstTR.topStart: it is the start of
      // the element holding the first one.
      let rest = "";
      let pos = firstTR.topStart;
      for (const r of textRuns) {
        rest += paraBlock.slice(pos, r.start);
        pos = r.end;
      }
      rest += paraBlock.slice(pos);

      return paraBlock.slice(0, firstTR.topStart) + newRuns + rest;
    },
  );
}
