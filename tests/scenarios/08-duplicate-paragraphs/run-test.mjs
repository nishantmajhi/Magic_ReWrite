// Test 08 - Duplicate paragraph text (previously a known bug, now fixed)
//
// The doc has the exact same sentence appearing twice, in two different
// sections, each given a DIFFERENT revision ("version ONE" for the first
// occurrence, "version TWO" for the second).
//
// buildAlignmentMap() correctly figured out block-level matches per
// occurrence (extIdx 0 -> "version ONE", extIdx 2 -> "version TWO") using
// its `claimed` set. But `lineMapping` used to be a plain key→value Map
// keyed by the NORMALIZED ORIGINAL TEXT of single-line blocks - and since
// both occurrences share identical original text, they shared the same
// key, and whichever block was processed last silently overwrote the
// first's entry in that map. The result was both occurrences in the
// output getting the same revision, with one dropped entirely.
//
// Fixed by making lineMapping store an ARRAY of {extIdx, value}
// candidates per key (sorted by document position) instead of a single
// value, and having both findXmlIdx() and resolveRevised() in
// docx-writer.js pick the candidate matching the specific extIdx (or the
// first not-yet-consumed one, for the initial index lookup) rather than
// whatever the shared slot happened to contain last.
import fs from "fs";
import { runPipeline, splitRevisedParas } from "../../helpers/harness.mjs";
import { check } from "../../helpers/assert.mjs";

const revisedText = fs.readFileSync(
  new URL("./revised.txt", import.meta.url),
  "utf8",
);
const revisedParas = splitRevisedParas(revisedText);
check(
  "Fixture supplies a DIFFERENT revision for each of the 2 duplicate occurrences",
  revisedParas.length === 4,
);

const result = await runPipeline(
  new URL("./input.docx", import.meta.url),
  revisedParas,
);
fs.writeFileSync(
  new URL("./actual_output.docx", import.meta.url),
  result.outputBuf,
);
const text = await result.extractOutputText();

const oneCount = (text.match(/version ONE/g) || []).length;
const twoCount = (text.match(/version TWO/g) || []).length;

check(
  "First occurrence keeps its own distinct revision ('version ONE'), exactly once",
  oneCount === 1,
  `found "version ONE" ${oneCount} time(s)`,
);
check(
  "Second occurrence keeps its own distinct revision ('version TWO'), exactly once - not duplicated onto both paragraphs",
  twoCount === 1,
  `found "version TWO" ${twoCount} time(s)`,
);
check(
  "Unrelated unique paragraphs (Section A / Section B context) are unaffected",
  text.includes("now reworded slightly") && text.includes("also reworded"),
);

