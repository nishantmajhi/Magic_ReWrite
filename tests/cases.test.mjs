import "./helpers/dom.mjs";
import { test } from "node:test";
import { ROOT, loadModules } from "./helpers/roots.mjs";
import { cases } from "./cases.mjs";

const mods = await loadModules(ROOT);

for (const c of cases) {
  test(`${c.regression ? "regression: " : ""}${c.name}`, () => c.run(mods));
}
