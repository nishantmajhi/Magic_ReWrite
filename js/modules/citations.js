"use strict";

/* ═══════════════════════════════════════════════
     IN-TEXT CITATIONS
     Stripped before the text is handed out for
     revision, put back after it returns.
  ═══════════════════════════════════════════════ */

/*
 * Why strip at all: a rewriter handed "…breaches rose sharply (OAIC 2025a)."
 * will cheerfully paraphrase the citation along with the prose, producing
 * "(the Commissioner's 2025 figures)" or dropping it outright. So citations
 * come out before the text is copied, and go back in after the revision is
 * pasted. Removing them is only half a round trip; a document that comes back
 * without its citations is not usable academic work.
 */

/* A citation unit is an author or organisation followed by a year, with an
   optional a/b/c suffix: "Smith 2020", "OAIC 2025a". One bracket can hold
   several, separated by semicolons.

   The author part excludes digits on purpose. That is what keeps ordinary
   parentheticals ending in a year out of the net - the "2," in "(Schedule 2,
   to be in force from 10 June 2025)" stops the match dead, which is what
   should happen. Requiring a capital first letter is deliberate too, so
   "(see Smith 2020)" is left whole rather than half-stripped. */
const CITE_UNIT = "[A-Z][A-Za-z\\s,&.'\\u2019-]*?\\s\\d{4}[a-z]?";

/* Numeric styles - "[1]", "[1,2]", "[1-3]". Capped at three digits so a law
   report year keeps its brackets: "ASIC v RI Advice Group Pty Ltd [2022] FCA
   496" is part of a case name, not a reference number, and stripping it
   silently corrupted the citation. No reference list runs to four figures. */
const CITE_NUM = "\\[\\d{1,3}(?:\\s*[,\\-\\u2013]\\s*\\d{1,3})*\\]";

export const CITAT =
  "(\\(" + CITE_UNIT + "(?:\\s*;\\s*" + CITE_UNIT + ")*\\)|" + CITE_NUM + ")";

export const citationRe = () => new RegExp(CITAT, "g");

/** Collapse the gap a removed citation leaves behind, including the space
 *  that would otherwise be stranded before the sentence's full stop. */
function tidy(t) {
  return t
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([.,;:!?])/g, "$1")
    .trim();
}

/** Strip citations, discarding them. For callers with nothing to restore. */
export const sc = (t) => tidy(String(t || "").replace(citationRe(), ""));

/**
 * Strip citations and record what was removed.
 *
 * Each record keeps the citation exactly as written plus the index of the
 * sentence it sat in, counted over the original text. That index is how it
 * finds its way home: a citation supports one specific claim, so dropping
 * them all at the end of the paragraph would silently re-attribute every one.
 *
 * @param {string} text
 * @returns {{ text: string, cites: Array<{marker: string, sentence: number}> }}
 */
export function stripCitations(text) {
  const src = String(text || "");
  const cites = [];
  const re = citationRe();
  let m;
  while ((m = re.exec(src)) !== null) {
    const before = src.slice(0, m.index);
    // atEnd: nothing but closing punctuation stands between the citation and
    // the end of its sentence. That is the ordinary Harvard position, and the
    // only one that can be reproduced faithfully in rewritten prose - a
    // mid-sentence citation has no stable anchor once the words around it
    // have changed, so it is reported rather than silently misplaced.
    const after = src.slice(m.index + m[0].length);
    const atEnd = /^\s*["')\]]*\s*([.!?]|$)/.test(after);
    cites.push({
      marker: m[0],
      sentence: (before.match(/[.!?]["')\]]?\s+/g) || []).length,
      atEnd,
    });
  }
  return { text: tidy(src.replace(citationRe(), "")), cites };
}

/** Split into sentences, keeping each one's terminal punctuation and the
 *  whitespace that follows it, so the pieces rejoin losslessly. */
function splitSentences(text) {
  const parts = String(text || "").match(/[^.!?]*(?:[.!?]+["')\]]*\s*|$)/g);
  return (parts || []).filter((p) => p.length > 0);
}

/**
 * Put stripped citations back into revised text.
 *
 * Each citation returns to the sentence it came from, by index. When the
 * revision has fewer sentences than the original - a rewriter merging two
 * into one, say - the surplus citations attach to the final sentence rather
 * than being dropped: a citation in a slightly wrong place is a fixable
 * problem, a missing one is an uncited claim.
 *
 * Placement within the sentence is before the terminal punctuation, which is
 * where Harvard style puts it: "…rose sharply (OAIC 2025a)."
 *
 * @param {string} revisedText
 * @param {Array<{marker: string, sentence: number}>} cites
 * @returns {string}
 */
export function restoreCitations(revisedText, cites) {
  const text = String(revisedText || "");
  if (!cites || !cites.length) return text;
  if (!text.trim()) return text;

  const sentences = splitSentences(text);
  if (!sentences.length) return text;

  const lastIdx = sentences.length - 1;
  const perSentence = new Map();
  for (const c of cites) {
    const idx = Math.min(Math.max(c.sentence, 0), lastIdx);
    if (!perSentence.has(idx)) perSentence.set(idx, []);
    perSentence.get(idx).push(c.marker);
  }

  return sentences
    .map((s, i) => {
      const markers = perSentence.get(i);
      if (!markers) return s;
      const joined = markers.join(" ");
      // Split the sentence into body / terminal punctuation / trailing space
      // so the citation lands before the full stop and the spacing survives.
      const m = s.match(/^(.*?)([.!?]+["')\]]*)(\s*)$/s);
      if (!m) {
        const trail = s.match(/(\s*)$/)[1];
        return s.slice(0, s.length - trail.length) + " " + joined + trail;
      }
      const body = m[1].replace(/\s+$/, "");
      if (!body) return s;
      return `${body} ${joined}${m[2]}${m[3]}`;
    })
    .join("");
}

/**
 * Build a lookup from extracted line text to the citations taken out of it.
 *
 * Keyed by normalised text, which is the only thing the extractor and the
 * alignment map reliably share - block and line indices are re-derived
 * independently by each consumer, so they can't be used as keys.
 *
 * If the very same sentence appears twice with different citations, the
 * first occurrence's citations are used for both. Two identical sentences
 * carrying different sources is rare enough to accept, and the alternative -
 * a consuming queue - would depend on consumers reading the index in
 * document order, which neither of them guarantees.
 */
export function buildCitationIndex(entries) {
  const index = new Map();
  for (const { text, cites } of entries) {
    if (!cites || !cites.length) continue;
    const key = normKey(text);
    if (!key || index.has(key)) continue;
    index.set(key, cites);
  }
  return index;
}

export const normKey = (t) =>
  String(t || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

/** Citations stripped from a line, or null. Does not consume. */
export function getCitations(index, text) {
  if (!index || !index.size) return null;
  return index.get(normKey(text)) || null;
}

/** Convenience: restore into `revised` whatever was stripped from `original`. */
export function restoreFor(index, originalText, revisedText) {
  const cites = getCitations(index, originalText);
  return cites ? restoreCitations(revisedText, cites) : revisedText;
}
