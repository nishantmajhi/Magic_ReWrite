// Test 02 - Partial revision
//
// The user only pastes revised text for SOME sections (Introduction,
// Tokenisation, and the hybrid-model results paragraph), leaving the rest
// blank - simulating someone who hasn't finished pasting revisions for the
// whole document yet. Every paragraph that WASN'T revised must survive in
// the output completely unchanged (byte-identical text), and the ones that
// WERE revised must show the new wording.
import fs from "fs";
import { runPipeline, splitRevisedParas } from "../../helpers/harness.mjs";
import { check } from "../../helpers/assert.mjs";

const revisedText = fs.readFileSync(
  new URL("./revised.txt", import.meta.url),
  "utf8",
);
const revisedParas = splitRevisedParas(revisedText);
check(
  "Fixture only supplies revisions for 3 of the 10 sections",
  revisedParas.length < 10,
);

const result = await runPipeline(
  new URL("./input.docx", import.meta.url),
  revisedParas,
);
fs.writeFileSync(
  new URL("./actual_output.docx", import.meta.url),
  result.outputBuf,
);
const actualText = await result.extractOutputText();

check(
  "Revised Introduction wording appears in output",
  actualText.includes(
    "Over the last decade, neural language models have reshaped",
  ),
);
check(
  "Revised hybrid-model wording appears in output",
  actualText.includes(
    "The hybrid model posted the strongest perplexity numbers",
  ),
);

// Paragraphs from sections that were NOT touched must be byte-identical
// to the original.
const untouchedOriginals = [
  "Sequence modelling is the task of estimating the probability distribution over sequences of discrete tokens.",
  "Experiments were conducted on a curated corpus of 4.2 billion tokens drawn from",
  "Four baseline architectures were evaluated to provide a comprehensive comparison",
  "Fine-tuning experiments on GLUE and SuperGLUE benchmarks confirmed the advantages",
  "The results presented in this review confirm that scale and architecture interact",
  "This paper reviewed the current state of neural language model research",
];
for (const snippet of untouchedOriginals) {
  check(
    `Unrevised paragraph kept its original wording: "${snippet.slice(0, 40)}..."`,
    actualText.includes(snippet),
  );
}

check(
  "Original (pre-revision) wording of the revised Introduction paragraph is GONE",
  !actualText.includes("Neural language models have fundamentally transformed"),
);

