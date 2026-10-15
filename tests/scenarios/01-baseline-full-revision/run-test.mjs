// Test 01 - Baseline / full revision (regression test)
//
// Every extracted paragraph gets a revision, in original document order.
// This is the "happy path" and doubles as a regression guard: if this ever
// stops matching expected.docx, something in the core pipeline broke.
import fs from "fs";
import mammoth from "mammoth";
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

const actualText = await result.extractOutputText();
const { value: expectedText } = await mammoth.extractRawText({
  buffer: fs.readFileSync(new URL("./expected.docx", import.meta.url)),
});

check(
  "Full extracted text of generated docx matches expected.docx exactly",
  actualText === expectedText,
  `lengths: actual=${actualText.length} expected=${expectedText.length}`,
);

check(
  "Bold callout label 'Key insight:' is preserved and bolded",
  /Key insight:/.test(result.outputXml) &&
    /<w:b\/><w:bCs\/>.*Key insight/.test(result.outputXml.replace(/\n/g, "")),
);

check(
  "All 6 footnote references from the input survive into the output",
  (result.outputXml.match(/<w:footnoteReference/g) || []).length ===
    (result.inputXml.match(/<w:footnoteReference/g) || []).length,
);

