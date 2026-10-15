// Test 09 - Footnote integrity across drastic length changes
//
// The source doc has 10 footnote references across 8 paragraphs (some
// footnote numbers reused, e.g. a bibliography-style citation cited twice).
// This test revises EVERY footnoted paragraph - some shrunk to a couple of
// words, some expanded into much longer sentences - and checks that:
//   1. The exact same sequence of footnote ids survives, in the same order
//   2. Each individual footnote is still attached to the correct paragraph
//      (matched by its new, revised text) rather than drifting to a
//      neighboring paragraph or getting dropped/duplicated
import fs from "fs";
import {
  runPipeline,
  splitRevisedParas,
  extractFootnoteIds,
} from "../../helpers/harness.mjs";
import { check } from "../../helpers/assert.mjs";

const revisedText = fs.readFileSync(
  new URL("./revised.txt", import.meta.url),
  "utf8",
);
const revisedParas = splitRevisedParas(revisedText);

const result = await runPipeline(
  new URL("./input.docx", import.meta.url),
  revisedParas,
);
fs.writeFileSync(
  new URL("./actual_output.docx", import.meta.url),
  result.outputBuf,
);

const idsIn = extractFootnoteIds(result.inputXml);
const idsOut = extractFootnoteIds(result.outputXml);

check(
  "Input fixture really does have 10 footnote references to stress-test",
  idsIn.length === 10,
);
check(
  "Exact same footnote id SEQUENCE survives (same ids, same order, same count) despite drastic rewrites",
  JSON.stringify(idsIn) === JSON.stringify(idsOut),
  `in:  ${JSON.stringify(idsIn)}\n        out: ${JSON.stringify(idsOut)}`,
);

// Per-footnote paragraph attachment check: pull each <w:p>, and if it has a
// footnoteReference, record (id, visible text).
function paraFootnotePairs(xml) {
  const paras = xml.match(/<w:p[ >][\s\S]*?<\/w:p>/g) || [];
  const pairs = [];
  for (const p of paras) {
    const ids = [...p.matchAll(/<w:footnoteReference\s+w:id="(-?\d+)"/g)].map(
      (m) => m[1],
    );
    if (!ids.length) continue;
    const text = [...p.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)]
      .map((m) => m[1])
      .join("");
    for (const id of ids) pairs.push({ id, text });
  }
  return pairs;
}

const pairs = paraFootnotePairs(result.outputXml);
const expectations = [
  { id: "1", contains: "NLM." },
  { id: "2", contains: "Early RNNs hit vanishing-gradient" },
  { id: "3", contains: "Sequence modelling is the task" },
  { id: "2", contains: "Tokenisation choice significantly affects" },
  { id: "4", contains: "4.2B tokens." },
  {
    id: "5",
    contains: "Four baseline architectures were evaluated, all trained",
  },
  { id: "6", contains: "Hybrid wins." },
  { id: "6", contains: "Error analysis: most failures involved" },
  { id: "5", contains: "Scale and architecture interact in non-trivial ways." },
  { id: "1", contains: "This paper reviewed the current state" },
];

let mismatches = [];
expectations.forEach((exp, i) => {
  const actual = pairs[i];
  const ok =
    actual && actual.id === exp.id && actual.text.includes(exp.contains);
  if (!ok)
    mismatches.push(
      `  #${i}: expected id=${exp.id} text~"${exp.contains}" - got ${JSON.stringify(actual)}`,
    );
});
check(
  "Every one of the 10 footnotes is attached to its correct (newly revised, drastically resized) paragraph",
  mismatches.length === 0,
  mismatches.join("\n"),
);

check(
  "Shrunk paragraph ('NLM.') really did shrink and the footnote right after it wasn't lost",
  pairs.some((p) => p.text === "NLM." && p.id === "1"),
);
check(
  "Expanded paragraph (Error analysis, 2nd occurrence of footnote 6) really did expand",
  pairs.some((p) => p.id === "6" && p.text.length > 150),
);

