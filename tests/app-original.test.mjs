// app-cases.mjs against the original page. See original.test.mjs.
import assert from "node:assert/strict";
import { test } from "node:test";
import { startApp } from "./helpers/app.mjs";
import { originalRoot } from "./helpers/roots.mjs";
import { appCases } from "./app-cases.mjs";

const root = originalRoot();
const app = root && (await startApp(root));

for (const c of appCases) {
  test(`original ${c.regression ? "fails" : "passes"}: ${c.name}`, { skip: !root && "original commit not available from git" }, async () => {
    app.close();
    if (!c.regression) return c.run(app);
    await assert.rejects(() => c.run(app), assert.AssertionError);
  });
}
