// Test 12 - Reference removal, citation round trip, canvas budgets
//
// Three defects reported against the ELL_917 pipeline, all in the same area:
//
// 1. The reference list was being handed to the rewriter as body text. The
//    old bibliography heuristic only recognised "1. " or "Smith, J. " openers
//    with a parenthesised (2020); Harvard entries like "Australian Signals
//    Directorate 2025, Annual Cyber Threat Report…" match none of that.
//    Style names alone can't fix it either - the HEADING is styled, but the
//    entries beneath it are plain Normal paragraphs.
//
// 2. In-text citations were stripped and then thrown away. Nothing recorded
//    where they had been, so the revised document came back with every
//    citation gone - a half-finished round trip that produced uncited prose.
//
// 3. Paid mode was one unbounded canvas rather than a larger budget.
import fs from "fs";
import { JSDOM } from "jsdom";
import mammoth from "mammoth";
import { check } from "../../helpers/assert.mjs";

global.DOMParser = new JSDOM("").window.DOMParser;
const M = "../../../js/modules/";
const { processElements, splitIntoCanvases } = await import(M + "extractor.js");
const { stripCitations, restoreCitations } = await import(M + "citations.js");
const { FREE_WORD_LIMIT, PAID_WORD_LIMIT } = await import(M + "constants.js");
const { state } = await import(M + "state.js");
const { gtxt, bFlag, tVals } = await import(M + "mammoth-helpers.js");

function extract(buf) {
  const elems = [];
  return mammoth
    .convertToHtml(
      { buffer: buf },
      {
        transformDocument: (doc) => {
          for (const ch of doc.children || []) {
            if (ch.type === "paragraph")
              elems.push({
                type: "p",
                st: ch.styleName || ch.styleId || "Normal",
                raw: gtxt(ch).trim(),
                bold: bFlag(ch),
                isList: !!ch.numbering,
                ni: ch.numbering?.numId ?? null,
                lv: ch.numbering?.level ?? 0,
              });
            else if (ch.type === "table") elems.push({ type: "t", v: tVals(ch) });
          }
          return doc;
        },
      },
    )
    .then(() => processElements(elems));
}

const real = await extract(
  fs.readFileSync(new URL("./input.docx", import.meta.url)),
);

/* ── 1. The reference list is gone ───────────────────────────────────── */

check(
  "No bibliography entry survives into the extracted text",
  !/viewed 16 August 2026/.test(real.out),
);
check(
  "The reference list's words are out of the budget too",
  real.nW < 4300,
  `extracted ${real.nW} words (was 4650 with the bibliography in)`,
);
check(
  "Body text itself is untouched - the last sentence is still there",
  /judged on their improvisation\.?$/.test(real.out.trim()),
  `tail: ${JSON.stringify(real.out.trim().slice(-60))}`,
);

/* ── 2. Citations are held, not discarded ────────────────────────────── */

let held = 0;
for (const cites of real.citationIndex.values()) held += cites.length;
check(
  "Every in-text citation in the document is held for restore",
  held === 18,
  `held ${held}, expected 18`,
);
check(
  "None are left stranded as literal text in the extracted output",
  !/\([A-Z][^()]{0,80}\d{4}[a-z]?\)/.test(real.out),
  (real.out.match(/\([A-Z][^()]{0,80}\d{4}[a-z]?\)/g) || []).join(" · "),
);

/* ── 3. What must and must not be treated as a citation ──────────────── */

const strips = [
  ["a plain author-date citation", "(Smith 2020)"],
  ["a letter-suffixed year", "(OAIC 2025a)"],
  ["an organisation with connecting words", "(Bird and Bird 2024)"],
  ["an ampersand author pair", "(Smith & Jones 2020)"],
  // The old regex could not cross the first year's digits, so these three
  // were left inline as literal text in the middle of the extracted prose.
  ["two sources in one bracket", "(Kennedys 2025; Rigby Cooke Lawyers 2025)"],
  ["a numeric reference tag", "[1]"],
  ["a numeric range", "[1-3]"],
];
for (const [label, marker] of strips) {
  const r = stripCitations(`Claim ${marker}.`);
  check(`Strips ${label}`, r.cites.length === 1 && r.text === "Claim.");
}

const keeps = [
  ["a parenthetical that merely ends in a year", "(Schedule 2, to be in force from 10 June 2025)"],
  ["a date parenthetical", "(the grace period will expire on 10 December 2026)"],
  ["a jurisdiction tag", "(Cth)"],
  // A law report year inside a case name. The old numeric pattern deleted
  // this outright, silently corrupting the case citation.
  ["a law report year in a case name", "[2022]"],
];
for (const [label, marker] of keeps) {
  const r = stripCitations(`Text ${marker} more.`);
  check(
    `Leaves ${label} alone`,
    r.cites.length === 0 && r.text.includes(marker),
    `got ${JSON.stringify(r.text)}`,
  );
}

/* ── 4. The round trip ───────────────────────────────────────────────── */

const roundTrips = [
  "Breaches rose sharply (OAIC 2025a).",
  "First claim (Smith 2020). Second claim (Jones 2021; Wu 2022). Third has none.",
  "Ends without punctuation (Smith 2020)",
  "No citations here at all.",
];
for (const original of roundTrips) {
  const { text, cites } = stripCitations(original);
  check(
    `Restores exactly: ${JSON.stringify(original.slice(0, 42))}`,
    restoreCitations(text, cites) === original,
    `got ${JSON.stringify(restoreCitations(text, cites))}`,
  );
}

// The point of recording a sentence index rather than appending everything at
// the end of the paragraph.
{
  const { cites } = stripCitations(
    "Incidents increased last year (OAIC 2025a). Regulators responded (ASIC 2026).",
  );
  const revised = restoreCitations(
    "Incidents climbed steeply over the year. The regulator answered with fines.",
    cites,
  );
  check(
    "Each citation returns to its own sentence in rewritten prose",
    revised ===
      "Incidents climbed steeply over the year (OAIC 2025a). The regulator answered with fines (ASIC 2026).",
    revised,
  );

  // Degradation: a rewriter that merges two sentences must not lose a source.
  const merged = restoreCitations("Incidents climbed and regulators fined.", cites);
  check(
    "A merged rewrite keeps both citations rather than dropping one",
    merged.includes("(OAIC 2025a)") && merged.includes("(ASIC 2026)"),
    merged,
  );
}

check(
  "A line with no citations is returned untouched",
  restoreCitations("Plain sentence.", []) === "Plain sentence.",
);

/* ── 5. Canvas budgets ───────────────────────────────────────────────── */

check("Paid budget is 5000 words", PAID_WORD_LIMIT === 5000);
check("Free budget is unchanged at 1000", FREE_WORD_LIMIT === 1000);
check("Paid is the default account mode", state.isPaidAccount === true);

const wordsOf = (t) => t.split(/\s+/).filter(Boolean).length;
for (const [label, limit] of [
  ["Free", FREE_WORD_LIMIT],
  ["Paid", PAID_WORD_LIMIT],
]) {
  const chunks = splitIntoCanvases(real.out, limit);
  const over = chunks.filter((c) => wordsOf(c) > limit);
  check(
    `${label} canvases each stay within ${limit} words`,
    over.length === 0,
    `${over.length} of ${chunks.length} over budget: ${over.map(wordsOf).join(", ")}`,
  );
  check(
    `${label} split loses no words`,
    wordsOf(chunks.join(" ")) === wordsOf(real.out),
    `${wordsOf(chunks.join(" "))} vs ${wordsOf(real.out)}`,
  );
}

// The document is ~4.1k words, so it is one canvas on Paid and several on
// Free - which is the whole point of the larger budget.
check(
  "This document fits a single Paid canvas but not a single Free one",
  splitIntoCanvases(real.out, PAID_WORD_LIMIT).length === 1 &&
    splitIntoCanvases(real.out, FREE_WORD_LIMIT).length > 1,
  `paid=${splitIntoCanvases(real.out, PAID_WORD_LIMIT).length}, free=${splitIntoCanvases(real.out, FREE_WORD_LIMIT).length}`,
);

