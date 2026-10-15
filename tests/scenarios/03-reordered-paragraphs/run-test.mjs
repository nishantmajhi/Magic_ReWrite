// Test 03 - Reordered revised paragraphs
//
// buildAlignmentMap() matches revised paragraphs to original ones by
// content similarity. This checks robustness to the revised paragraphs
// being supplied out of the source document's order.
//
// Scenario A (mild - adjacent swap): resolves via the pass-1 exact-match
// step, which considers the whole array regardless of position.
//
// Scenario B (adversarial - full reversal): previously exposed a real bug
// - a sequential "claim the first good-enough match" strategy let an
// earlier-processed paragraph steal a block that a later paragraph (in
// original array order) was actually the best match for, so a prose
// paragraph ended up mismatched to a table-derived block. Fixed by
// switching to a global greedy max-weight matching: every (revised
// paragraph, extracted block) pair is scored up front and assignments are
// made strictly in descending similarity order, so the strongest match
// always wins regardless of which order paragraphs were supplied in.
import fs from "fs";
import mammoth from "mammoth";
import { runPipeline, splitRevisedParas } from "../../helpers/harness.mjs";
import { check } from "../../helpers/assert.mjs";

const revisedText = fs.readFileSync(
  new URL("./revised_in_order.txt", import.meta.url),
  "utf8",
);
const paras = splitRevisedParas(revisedText);

const { value: expectedText } = await mammoth.extractRawText({
  buffer: fs.readFileSync(
    new URL("../01-baseline-full-revision/expected.docx", import.meta.url),
  ),
});

/* ── Scenario A: mild adjacent swap ─────────────────────────────── */
const mild = [...paras];
[mild[0], mild[1]] = [mild[1], mild[0]];
const resultMild = await runPipeline(
  new URL("./input.docx", import.meta.url),
  mild,
);
fs.writeFileSync(
  new URL("./actual_output_mild_swap.docx", import.meta.url),
  resultMild.outputBuf,
);
const actualMildText = await resultMild.extractOutputText();

check(
  "Scenario A (adjacent swap): still resolves to the exact same correct output as in-order input",
  actualMildText === expectedText,
);

/* ── Scenario B: full reversal (previously a known bug - now fixed) ── */
const reversed = [...paras].reverse();
const resultRev = await runPipeline(
  new URL("./input.docx", import.meta.url),
  reversed,
);
fs.writeFileSync(
  new URL("./actual_output_full_reversal.docx", import.meta.url),
  resultRev.outputBuf,
);
const actualRevText = await resultRev.extractOutputText();

check(
  "Scenario B (full reversal): output matches expected content regardless of input order",
  actualRevText === expectedText,
);

