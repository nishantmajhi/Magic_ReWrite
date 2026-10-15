// Runs cases.mjs against the code as it was before the cleanup. Regression
// cases must fail there; everything else must pass there, which shows it
// describes behaviour the original already had rather than something new.
import "./helpers/dom.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { loadModules, originalRoot } from "./helpers/roots.mjs";
import { cases } from "./cases.mjs";

const root = originalRoot();
const mods = root && (await loadModules(root));

for (const c of cases) {
  test(`original ${c.regression ? "fails" : "passes"}: ${c.name}`, { skip: !root && "original commit not available from git" }, async () => {
    if (!c.regression) return c.run(mods);
    await assert.rejects(() => Promise.resolve().then(() => c.run(mods)), assert.AssertionError);
  });
}
