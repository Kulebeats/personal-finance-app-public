// Unit tests for the production dependency audit gate (no network, no npm).
import assert from "node:assert/strict";
import { test } from "node:test";
import { collectAdvisories, evaluateAudit, validateExceptions } from "../check-production-audit.mjs";

const ZOD_ADVISORY = {
  name: "zod",
  severity: "high",
  title: "Zod can exhaust memory while validating oversized constrained collections",
  url: "https://github.com/advisories/GHSA-mrhx-c7xc-m3w5",
};
const MULTER_ADVISORY = {
  name: "multer",
  severity: "high",
  title: "multer vulnerable to Denial of Service",
  url: "https://github.com/advisories/GHSA-q7qp-rjg7-q26m",
};

function report(...advisories) {
  const vulnerabilities = {};
  for (const advisory of advisories) {
    vulnerabilities[advisory.name] = { severity: advisory.severity, via: [advisory] };
  }
  // A dependent package is reported with its parent's name instead of an advisory.
  vulnerabilities["zod-validation-error"] = { severity: "high", via: ["zod"] };
  return { vulnerabilities };
}

function exception(overrides = {}) {
  return {
    advisory: "GHSA-mrhx-c7xc-m3w5",
    package: "zod",
    reason: "Major upgrade tracked separately",
    approvedBy: "owner",
    approvedOn: "2026-11-15",
    expires: "2027-01-31",
    ...overrides,
  };
}

test("an advisory with no exception blocks", () => {
  const outcome = evaluateAudit(report(ZOD_ADVISORY, MULTER_ADVISORY), [exception()], "2026-11-15");

  assert.equal(outcome.passed, false);
  assert.deepEqual(outcome.blocking.map((advisory) => advisory.id), ["GHSA-Q7QP-RJG7-Q26M"]);
  assert.equal(outcome.accepted.length, 1);
});

test("a listed, unexpired advisory passes, including on its last valid day", () => {
  const outcome = evaluateAudit(report(ZOD_ADVISORY), [exception()], "2027-01-31");

  assert.equal(outcome.passed, true);
  assert.equal(outcome.blocking.length, 0);
});

test("an expired exception fails the gate", () => {
  const outcome = evaluateAudit(report(ZOD_ADVISORY), [exception()], "2027-02-01");

  assert.equal(outcome.passed, false);
  assert.equal(outcome.expired.length, 1);
});

test("an exception for an advisory that is no longer reported fails the gate", () => {
  const outcome = evaluateAudit({ vulnerabilities: {} }, [exception()], "2026-11-15");

  assert.equal(outcome.passed, false);
  assert.deepEqual(outcome.unused.map((entry) => entry.advisory), ["GHSA-mrhx-c7xc-m3w5"]);
});

test("a clean report with no exceptions passes", () => {
  const outcome = evaluateAudit({ vulnerabilities: {} }, [], "2026-11-15");

  assert.equal(outcome.passed, true);
});

test("one advisory reaching several packages is collected once", () => {
  const shared = { ...ZOD_ADVISORY };
  const advisories = collectAdvisories({
    vulnerabilities: {
      zod: { severity: "high", via: [shared] },
      "other-package": { severity: "high", via: [shared] },
    },
  });

  assert.equal(advisories.length, 1);
  assert.deepEqual([...advisories[0].packages].sort(), ["other-package", "zod"]);
});

test("an exception without an expiry date is rejected", () => {
  assert.throws(() => validateExceptions([exception({ expires: "" })]), /missing "expires"/);
  assert.throws(() => validateExceptions([exception({ expires: "next year" })]), /YYYY-MM-DD/);
});
