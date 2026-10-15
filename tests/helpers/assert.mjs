// Each check is registered as its own node:test test, so `npm test` counts
// and reports them individually rather than one pass/fail per scenario file.
import { test } from "node:test";
import assert from "node:assert/strict";

export function check(label, condition, detail) {
  const pass = !!condition;
  test(label, () => assert.ok(pass, detail || label));
}
