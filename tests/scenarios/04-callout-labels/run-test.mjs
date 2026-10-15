// Test 04 - Bold "Label: body" callout paragraphs
//
// processElements() detects paragraphs like "Scope: This review covers..."
// and splits them into a bold label + plain body for the docx writer to
// re-bold correctly no matter what the revised text looks like. This test
// checks:
//
// Scenario A (golden path - revised_correct.txt):
//   The user pastes revised text for a whole block on one "logical
//   paragraph" (single \n between its internal sentences, matching the
//   original block's line count). Even when the revision:
//     - drops the "Scope:" prefix entirely (still gets re-labeled)
//     - repeats the label in a different case, "KEY INSIGHT:" (gets
//       normalized back to the original casing, not duplicated)
//   ...every callout across 4 different sections should come out correctly
//   bolded with the right body text.
//
// Scenario B (revised_broken_midblock.txt - previously a known bug, now
// fixed):
//   If the user's revised text has an EXTRA blank line in the middle of
//   what is, in the source document, a single \n{4}-separated extraction
//   block (very easy to do by accident when copy-pasting from an AI chat
//   reply that adds paragraph spacing), the block used to get split into
//   two competing revised paragraphs, with only the first winning the
//   block match and the second silently reverting to original text.
//   Fixed with an "orphan paragraph reattachment" pass: when a revised
//   paragraph doesn't match anything on its own, but the paragraph
//   immediately before it (in the order supplied) matched a block that
//   still has unfilled lines, the orphan is appended as additional
//   content for that same block instead of being dropped.
import fs from "fs";
import { runPipeline, splitRevisedParas } from "../../helpers/harness.mjs";
import { check } from "../../helpers/assert.mjs";

/* ── Scenario A ──────────────────────────────────────────────────── */
const correctText = fs.readFileSync(
  new URL("./revised_correct.txt", import.meta.url),
  "utf8",
);
const correctParas = splitRevisedParas(correctText);
const resultA = await runPipeline(
  new URL("./input.docx", import.meta.url),
  correctParas,
);
fs.writeFileSync(
  new URL("./actual_output_correct.docx", import.meta.url),
  resultA.outputBuf,
);
const textA = await resultA.extractOutputText();

const boldRuns =
  resultA.outputXml.match(
    /<w:r><w:rPr><w:b\/><w:bCs\/><\/w:rPr><w:t[^>]*>([^<]*)<\/w:t><\/w:r>/g,
  ) || [];
const boldLabels = boldRuns.map((r) => r.match(/<w:t[^>]*>([^<]*)<\/w:t>/)[1]);

check(
  "'Scope:' revised without user re-typing the prefix still gets bolded with the label",
  boldLabels.includes("Scope: "),
);
check(
  "'KEY INSIGHT:' (different case, prefix included by user) normalizes to original-cased 'Key insight: ' - not duplicated",
  boldLabels.includes("Key insight: ") && !textA.includes("KEY INSIGHT"),
);
check(
  "'Error analysis:' callout correctly bolded",
  boldLabels.includes("Error analysis: "),
);
check(
  "'Limitations:' callout correctly bolded",
  boldLabels.includes("Limitations: "),
);
check(
  "Revised body text for the Scope callout appears (not the original wording)",
  textA.includes("focusing on encoder-decoder and decoder-only variants") &&
    !textA.includes("with particular attention to encoder-decoder"),
);
check(
  "Revised body text for the Limitations callout appears (not the original wording)",
  textA.includes("this survey skips multimodal models"),
);

/* ── Scenario B - previously a known bug, now fixed ─────────────────── */
const brokenText = fs.readFileSync(
  new URL("./revised_broken_midblock.txt", import.meta.url),
  "utf8",
);
const brokenParas = splitRevisedParas(brokenText);
check(
  "Fixture for scenario B really does produce 2 separate paragraphs from 1 source block",
  brokenParas.length === 2,
);

const resultB = await runPipeline(
  new URL("./input.docx", import.meta.url),
  brokenParas,
);
fs.writeFileSync(
  new URL("./actual_output_broken.docx", import.meta.url),
  resultB.outputBuf,
);
const textB = await resultB.extractOutputText();

check(
  "Scenario B: the 'Scope:' half of the block (2nd revised paragraph, split off by a " +
    "stray blank line) now also applies instead of silently falling back to original text",
  textB.includes(
    "This review covers models trained between 2017 and 2024, focusing on",
  ),
);

