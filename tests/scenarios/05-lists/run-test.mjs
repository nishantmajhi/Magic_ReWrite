// Test 05 - Bulleted / numbered list items
//
// The extractor prefixes bullet items with "- " (see pfx() in extractor.js)
// so users editing/rewriting the plain-text extraction can see list
// structure. When writing back to the docx, patchDocumentXml must strip
// that synthetic prefix back off - and it also needs to tolerate a user
// accidentally typing a NUMBERED prefix ("1. ") on what is actually a
// bulleted list item, since the numbering itself lives in <w:numPr> (Word
// auto-numbers), not in the text.
import fs from "fs";
import { runPipeline, splitRevisedParas } from "../../helpers/harness.mjs";
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
const text = await result.extractOutputText();

check(
  "List-formatted paragraphs (<w:numPr>) count is unchanged - no list items lost or added",
  (result.outputXml.match(/<w:numPr>/g) || []).length ===
    (result.inputXml.match(/<w:numPr>/g) || []).length,
);

check(
  "Revised bullet given WITH a '- ' prefix by the user has the prefix stripped, not doubled",
  text.includes(
    "Character-level models: see everything, but sequences get extremely long.",
  ) && !text.includes("- - Character-level"),
);
check(
  "Revised bullet given WITHOUT any prefix comes through untouched otherwise",
  text.includes(
    "Vanilla Transformer: a standard encoder-decoder using learned positional embeddings.",
  ),
);
check(
  "Revised bullet mistakenly typed with a NUMBERED prefix ('1. ') still has it stripped " +
    "(numbering lives in Word's <w:numPr>, not in the text)",
  text.includes(
    "GPT-style decoder: causal language modelling for autoregressive generation.",
  ) && !text.includes("1. GPT-style decoder"),
);

const remainingBulletDashes = (text.match(/^-\s/gm) || []).length;
check(
  "No stray leading '- ' characters remain anywhere in the revised list text",
  remainingBulletDashes === 0,
  `found ${remainingBulletDashes} stray dash-prefixed lines`,
);

check(
  "Table (unrelated to the lists) is completely untouched - same cell text before/after",
  (result.outputXml.match(/<w:tbl[ >][\s\S]*?<\/w:tbl>/) || [""])[0] ===
    (result.inputXml.match(/<w:tbl[ >][\s\S]*?<\/w:tbl>/) || [""])[0],
);

