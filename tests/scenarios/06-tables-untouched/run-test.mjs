// Test 06 - Tables are never touched
//
// patchDocumentXml() explicitly pre-scans <w:tbl>...</w:tbl> ranges and
// skips any paragraph whose offset falls inside one (isInTable()), no
// matter what the alignment map says. Table text is also excluded up
// front during extraction (dTable() dedupes it via the `ct` set in
// processElements), but it still shows up as its OWN block in the
// extracted text - which means a revised paragraph COULD accidentally
// (or adversarially) score a high similarity match against that
// table-derived block. This test feeds exactly that adversarial input -
// revised text that mimics the table's own flattened content, with
// altered numbers - and confirms it has zero effect on the actual table.
import fs from "fs";
import {
  runPipeline,
  splitRevisedParas,
  extractTables,
} from "../../helpers/harness.mjs";
import { check } from "../../helpers/assert.mjs";

const revisedText = fs.readFileSync(
  new URL("./revised.txt", import.meta.url),
  "utf8",
);
const revisedParas = splitRevisedParas(revisedText);
check(
  "Fixture supplies fake 'table-shaped' revised text (mimicking dTable's flattened format)",
  revisedParas.some((p) => p.includes("999M")),
);

const result = await runPipeline(
  new URL("./input.docx", import.meta.url),
  revisedParas,
);
fs.writeFileSync(
  new URL("./actual_output.docx", import.meta.url),
  result.outputBuf,
);

const tablesIn = extractTables(result.inputXml);
const tablesOut = extractTables(result.outputXml);

check("Exactly one table found in the source document", tablesIn.length === 1);
check(
  "Table XML is BYTE-IDENTICAL before and after - adversarial revision had zero effect",
  tablesIn[0] === tablesOut[0],
);
check(
  "The fake '999M' parameter values never leak into the output document anywhere",
  !result.outputXml.includes("999M"),
);

const text = await result.extractOutputText();
check(
  "Original table values (110M, 125M, 117M, 240M) are all still present and correct",
  ["110M", "125M", "117M", "240M"].every((v) => text.includes(v)),
);

