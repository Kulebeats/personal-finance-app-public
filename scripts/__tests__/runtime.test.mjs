import assert from "node:assert/strict";
import { test } from "node:test";
import { checkRuntime } from "../check-runtime.mjs";

test("local, locked, CI and deployment runtime declarations agree", () => {
  assert.equal(checkRuntime(), "24.22.0");
});

test("unsupported and mismatched runtimes fail before app/DB import", () => {
  for (const version of ["20.19.0", "22.23.2", "24.21.0", "26.12.0"]) {
    assert.throws(() => checkRuntime(version), /Node 24.22.0 is required/);
  }
});
