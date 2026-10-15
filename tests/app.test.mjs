import { test } from "node:test";
import { startApp } from "./helpers/app.mjs";
import { ROOT } from "./helpers/roots.mjs";
import { appCases } from "./app-cases.mjs";

const app = await startApp(ROOT);

for (const c of appCases) {
  test(`${c.regression ? "regression: " : ""}${c.name}`, async () => {
    app.close();
    await c.run(app);
  });
}

test("the page raised no script errors", () => {
  if (app.errors.length) throw app.errors[0];
});
