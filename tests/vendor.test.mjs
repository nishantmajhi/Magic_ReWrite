// The page runs vendor/*.min.js; the tests run the npm packages. They are
// only the same library if the files are the same bytes.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { test } from "node:test";
import { ROOT } from "./helpers/roots.mjs";

const require = createRequire(import.meta.url);
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const same = (a, b) => fs.readFileSync(a).equals(fs.readFileSync(b));

for (const [name, vendored, built] of [
  ["mammoth", "mammoth.browser.min.js", "mammoth.browser.min.js"],
  ["jszip", "jszip.min.js", "dist/jszip.min.js"],
]) {
  const dir = path.dirname(require.resolve(`${name}/package.json`));
  const installed = require(`${name}/package.json`).version;

  test(`${name} is pinned to one exact version`, () => {
    assert.match(pkg.devDependencies[name], /^\d+\.\d+\.\d+$/);
    assert.equal(installed, pkg.devDependencies[name]);
  });

  test(`vendor/${vendored} is the ${name} ${installed} build the tests run`, () => {
    assert.ok(same(path.join(ROOT, "vendor", vendored), path.join(dir, built)));
  });

  test(`${name}'s licence is shipped beside it`, () => {
    assert.ok(fs.readdirSync(path.join(ROOT, "vendor")).some((f) => f.startsWith(`${name}.LICENSE`)));
  });
}
