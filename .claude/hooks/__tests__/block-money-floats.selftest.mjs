import { findMoneyFloatViolations as f } from "../block-money-floats.mjs";

const MUST_BLOCK = {
  "parseFloat on amount": "const v = parseFloat(row.amount);",
  toFixed: "return total.toFixed(2);",
  "Number(amount)": "const n = Number(tx.amount) + 1;",
  "amount*rate": "const converted = amount * rate;",
  "rate*amount": "const converted = rate * amount;",
  "parseFloat mid-line": "  const x = 1; const y = parseFloat(a.amount);",
};

const MUST_ALLOW = {
  "JSDoc amount+star+strategy":
    " * Keyed on date+type+amount only: matches what the\n * coppercoin strategy needs.",
  "JSDoc deliberately+amount":
    " * Deliberately narrow.\n * The amount is preserved.",
  "line comment mentioning parseFloat": "  // never use parseFloat( here",
  "Money usage": "const amount = new Money(row.amount).add(other);",
  "toNumber at boundary": "const v = new Money(x).toNumber();",
  "separate + amount prose": " * A separate note about the amount field.",
  "trailing comment after safe code":
    "const a = new Money(x); // amount * rate would be wrong",
};

let fail = 0;
for (const [k, v] of Object.entries(MUST_BLOCK)) {
  if (f(v).length === 0) {
    console.log("FAIL (should block):", k);
    fail++;
  } else console.log("ok  block :", k);
}
for (const [k, v] of Object.entries(MUST_ALLOW)) {
  if (f(v).length > 0) {
    console.log("FAIL (should allow):", k);
    fail++;
  } else console.log("ok  allow :", k);
}
console.log(fail === 0 ? "\nALL PASS" : `\n${fail} FAILURES`);
process.exit(fail === 0 ? 0 : 1);
