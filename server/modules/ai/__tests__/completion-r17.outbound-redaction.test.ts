/**
 * R17 #246 Astra rounds 3 and 4: outbound redaction tables.
 *
 * Every example the reviewer gave, in the current message and in a replayed
 * assistant turn, plus the amounts and dates that must stay intact. The
 * structure under test: a normalised matching copy (Unicode dashes become
 * "-", whitespace runs one space) with offsets mapped back, a Luhn + first
 * digit card rule, Zambian phone shapes, and a 6-2-1 NRC with any separator.
 */
import { describe, expect, it } from "vitest";

import {
  buildMatchingCopy,
  isCardNumber,
  redactOutbound,
  redactOutboundText,
  type RedactionKind,
} from "../ai.outbound-redaction";

type LeakCase = readonly [label: string, text: string, kind: RedactionKind, leaked: string];

const MUST_REDACT: ReadonlyArray<readonly [string, string, RedactionKind, string]> = [
  // Astra r3 examples (must still hold)
  ["r3 dotted NRC", "NRC 123456.78.9", "nrc", "123456"],
  ["r3 newline-separated NRC", "NRC 123456\n78\n9", "nrc", "123456"],
  ["r3 dot then newline NRC", "NRC 123456.\n78.9", "nrc", "123456"],
  ["r3 split local phone", "ring 0 97 123 4567", "phone", "4567"],
  ["r3 mixed-script email", "mail alice@例子.com now", "email", "alice"],
  // Astra r4 bypasses
  ["r4 dashed national mobile", "ring 0-97-123-4567", "phone", "4567"],
  ["r4 Lusaka landline", "office 021 123 4567", "phone", "4567"],
  ["r4 en-dash NRC", "NRC 123456–78–9", "nrc", "123456"],
  ["r4 newline-wrapped card", "card 4111\n1111 1111 1111", "card", "1111"],
  ["r4 mixed-separator card", "card 4111 1111-1111 1111", "card", "1111"],
  // The same structure, other separators
  ["em-dash NRC", "NRC 123456—78—9", "nrc", "123456"],
  ["minus-sign NRC", "NRC 123456−78−9", "nrc", "123456"],
  ["spaced en-dash NRC", "NRC 123456 – 78 – 9", "nrc", "123456"],
  ["en-dash card", "card 4111–1111–1111–1111", "card", "1111"],
  ["dotted card", "card 4111.1111.1111.1111", "card", "1111"],
  ["spaced-dash card", "card 5555 - 5555 - 5555 - 4444", "card", "5555"],
  ["Amex with mixed separators", "amex 3782-822463 10005", "card", "822463"],
  ["13-digit card on two lines", "card 4222 2222\n2222 2", "card", "2222"],
  ["en-dash national mobile", "ring 097–123–4567", "phone", "4567"],
  ["+260 with dashes", "ring +260-97-123-4567", "phone", "4567"],
  ["+260 landline", "office +260 211 123 456", "phone", "123 456"],
  ["Airtel mobile", "ring 0771 234 567", "phone", "234 567"],
  ["bare mobile", "ring 971234567", "phone", "971234567"],
  ["bare grouped mobile", "ring 97 123 4567", "phone", "4567"],
  ["international number", "ring +44 20 7946 0958", "phone", "7946"],
  // Astra r5: a card next to other numbers, and a comma-delimited phone
  ["r5 card followed by a year", "Card 4111 1111 1111 1111 2025", "card", "4111"],
  ["r5 card followed by a CVV", "Card 4111 1111 1111 1111 123", "card", "4111"],
  ["r5 card in a numbered list", "1. 4111 1111 1111 1111", "card", "4111"],
  ["r5 comma-delimited phone", "Call,0971234567", "phone", "0971234567"],
  ["card after an amount", "Paid K 250 then card 5555 5555 5555 4444", "card", "5555"],
  ["two cards in one run", "4111 1111 1111 1111 5555 5555 5555 4444", "card", "5555"],
  ["phone after a colon", "phone:0971234567", "phone", "0971234567"],
  // coordinator probe: a contiguous 20+ digit run with a card at either end
  ["contiguous card then expiry", "ref 41111111111111112025", "card", "4111111111111111"],
  ["contiguous prefix then card", "ref 99994111111111111111", "card", "4111111111111111"],
  // Astra r6: every 13-19 digit window at every offset, and code-point dashes
  ["r6 card plus CVV in one contiguous run", "Card 4111111111111111123", "card", "4111"],
  ["r6 list marker fused to a contiguous card", "1. 41111111111111112025", "card", "4111"],
  ["r6 supplementary-plane dash card", "4111\u{10EAD}1111\u{10EAD}1111\u{10EAD}1111", "card", "4111"],
  // Coordinator ruling after r6: a strict ISO date ends a digit run
  ["card glued to a date", "2026-01-01 4111111111111111", "card", "4111"],
  ["dashed card then a date", "4111-1111-1111-1111 on 2026-01-01", "card", "4111"],
  // Fable r7 F1: a card whose last group reads as a year, then a date
  ["r7 card then a slash date", "card 4539 1488 0347 2025/01/28", "card", "4539"],
  ["r7 card then a dash date", "card 4539 1488 0347 2025-01-28", "card", "4539"],
  ["r7 dashed card then a date", "card 4539-1488-0347-2025-01-28", "card", "4539"],
  ["r7 en-dashed card then a date", "card 4539\u20131488\u20130347\u20132025\u201301\u201328", "card", "4539"],
  ["r7 card ending 1999 then a date", "card 5555-5555-5550-1999-12-25", "card", "5555"],
  // Fable r7 F2: issuers the round 5 list dropped
  ["r7 Maestro 6759", "card 6759649826438453", "card", "67596498"],
  ["r7 Maestro 6304", "card 6304000000000000", "card", "63040000"],
  ["r7 Verve 19 digits", "card 5061460410120223210", "card", "50614604"],
  ["r7 UnionPay 81", "card 8171999927660000", "card", "81719999"],
  ["r7 Dankort", "card 5019555544445555", "card", "50195555"],
  ["r7 grouped 5018", "my card is 5018 1230 0000 0009", "card", "5018"],
  // Fable r7 F3: 260 / 00260 without "+", and the newer operator codes
  ["r7 260 without plus", "call 260971234567", "phone", "971234567"],
  ["r7 wa.me link", "wa.me/260971234567", "phone", "971234567"],
  ["r7 00260 contiguous", "call 00260971234567", "phone", "971234567"],
  ["r7 00260 spaced", "call 00260 97 1234567", "phone", "1234567"],
  ["r7 00260 dashed", "call 00260-97-1234567", "phone", "1234567"],
  ["r7 operator 098", "call 0981234567", "phone", "1234567"],
  ["r7 operator 057", "call 0571234567", "phone", "1234567"],
  // Fable r7 F4: more run joiners
  ["r7 slash-joined card", "card 4111/1111/1111/1111", "card", "4111"],
  ["r7 comma-joined card", "4111,1111,1111,1111", "card", "4111"],
  // Coordinator ruling after r7: a comma joins only after a 4+ digit group
  ["comma-spaced card", "4111, 1111, 1111, 1111", "card", "4111"],
  ["comma-joined Amex", "3782,822463,10005", "card", "822463"],
  ["comma-joined 19-digit card, short last group", "5061,4604,1012,0223,210", "card", "4604"],
  ["r7 underscore-joined card", "4111_1111_1111_1111", "card", "4111"],
  ["r7 colon-joined card", "4111:1111:1111:1111", "card", "4111"],
  ["r7 middle-dot card", "4111\u00B71111\u00B71111\u00B71111", "card", "4111"],
  ["r7 bullet card", "4111\u20221111\u20221111\u20221111", "card", "4111"],
  ["r7 full-width slash card", "4111\uFF0F1111\uFF0F1111\uFF0F1111", "card", "4111"],
  // Fable r7 F5: format characters inside a card
  ...["\u200E", "\u200F", "\u202A", "\u2066", "\u2062", "\u180E", "\u034F", "\u061C", "\uFE0F"].map(
    (mark) => [`r7 card with U+${mark.codePointAt(0)!.toString(16).toUpperCase()}`, ["4111", "1111", "1111", "1111"].join(mark), "card", "4111"] as const,
  ),
  // Fable r7 F6: other decimal-digit scripts
  ["r7 Arabic-Indic card", "\u0664" + "\u0661".repeat(15), "card", "\u0661\u0661\u0661\u0661"],
  ["r7 Extended Arabic-Indic card", "\u06F4" + "\u06F1".repeat(15), "card", "\u06F1\u06F1\u06F1\u06F1"],
  ["r7 Devanagari card", "\u096A" + "\u0967".repeat(15), "card", "\u0967\u0967\u0967\u0967"],
  ["r7 mixed-script card", "card 4111 \u0661\u0661\u0661\u0661 1111 1111", "card", "4111"],
  // Fable r7 F7: a card next to an email-like or NRC-like tail
  ["r7 card glued to an email domain", "4111 1111 1111 1111@gmail.com", "card", "1111"],
  ["r7 card before an @ merchant", "paid with 4111 1111 1111 1111 @ Shoprite.Manda Hill", "card", "1111"],
  ["r7 card before an expiry and a count", "card 5500 0000 0000 0004 12/26 1 item", "card", "5500"],
  // Fable r7 F8: a slash NRC after a currency word
  ["r7 slash NRC after K", "Banda K 123456/78/1", "nrc", "123456"],
  ["r7 slash NRC after USD", "USD 123456/78/1", "nrc", "123456"],
  // Fable r8 F9: what is redacted is the union of every rule's spans
  ["r8 three listed phones, second", "0970000001, 0950000002, 0970000003", "phone", "0000002"],
  ["r8 three listed phones, third", "0970000001, 0950000002, 0970000003", "phone", "0000003"],
  ["r8 two listed phones", "0960000004, 0970000005", "phone", "0000005"],
  ["r8 NRC then phone, the phone", "111111/44/1 0970000007", "phone", "0000007"],
  ["r8 NRC then phone, the NRC", "111111/44/1 0950000007", "nrc", "111111"],
  // A false card window over "44/1 0950000007" merges into the NRC placeholder:
  // nothing of either number is sent ("[nrc]"), only the count names one kind.
  ["r8 NRC then phone under one placeholder", "111111/44/1 0950000007", "nrc", "0000007"],
  ["r8 comma-joined phones", "0970000001,0950000002", "phone", "0000002"],
  ["r8 email whose local part holds a card", "john.4111111111111111@x.com", "email", "john"],
  // Fable r8 F12: bare mobiles take every operator code
  ["r8 bare 98 mobile", "ring 981234567", "phone", "1234567"],
  ["r8 bare 57 mobile", "ring 571234567", "phone", "1234567"],
  ["r8 bare grouped 55 mobile", "ring 55 123 4567", "phone", "4567"],
  // Fable r8 F13: combining marks between digit groups
  ["r8 card with U+0301 between groups", "4111\u03011111\u03011111\u03011111", "card", "1111"],
  ["r8 card with U+E0100 between groups", "4111\u{E0100}1111\u{E0100}1111\u{E0100}1111", "card", "1111"],
  // Fable r9 F14: a 9- or 12-digit run touching a comma is never a thousands group
  ["r10 CSV row with a 260 number", "John Banda,260971234567,500.00", "phone", "71234567"],
  ["r10 comma list of 260 numbers, first", "Send K50 to 260971234567,260961234567,260955123456", "phone", "71234567"],
  ["r10 comma list of 260 numbers, second", "Send K50 to 260971234567,260961234567,260955123456", "phone", "61234567"],
  ["r10 comma list of 260 numbers, third", "Send K50 to 260971234567,260961234567,260955123456", "phone", "55123456"],
  ["r10 260 number after an amount", "1500,260971234567,ok", "phone", "71234567"],
  ["r10 260 number after a decimal amount", "500.00,260971234567", "phone", "71234567"],
  ["r10 260 number before an amount", "260971234567,500.00", "phone", "71234567"],
  ["r10 comma-joined bare numbers, first", "971234567,961234567", "phone", "71234567"],
  ["r10 comma-joined bare numbers, second", "971234567,961234567", "phone", "61234567"],
  ["r10 bare number after a K amount", "K500,971234567", "phone", "71234567"],
  ["r10 bare number before an amount", "971234567,500", "phone", "71234567"],
  ["r10 bare number after a comma group", "Balance 12,971234567 is wrong", "phone", "71234567"],
  // Fable r9 F16: a 10- or 12-digit phone run is never a decimal part
  ["r10 dot-joined phones, first", "0971234567.0961234567", "phone", "71234567"],
  ["r10 dot-joined phones, second", "0971234567.0961234567", "phone", "61234567"],
  ["r10 dot-joined 260 numbers, second", "260971234567.260961234567", "phone", "61234567"],
  // Fable r9 F17: a combining mark after a joiner, not only after a digit
  ["r10 card with U+0301 after the space", "4111 \u03011111 1111 1111", "card", "4111"],
  ["r10 card with marks after dashes", "4111-\u0301\u03001111-1111-1111", "card", "4111"],
];

const MUST_STAY_INTACT: readonly string[] = [
  // Astra r3 and r4 false positives
  "Compare 2026-11-18 2026-11-19 please",
  "My balances were 100.00 200.00 300.00",
  "Total 1,234,567,890 so far",
  "My four payments were ZMW 1000 2000 3000 40",
  "My balance changed by +12345.67",
  // The same families
  "My balance changed by +1234567.89 overnight",
  "My balance changed by +1,234,567.89 overnight",
  "Years 2026 2027 2028 2029 compared",
  "Rent 4500.00 4500.00 4500.00 4500.00 this year",
  "The project costs ZMW 965 000 000 in total",
  "Reference 4111 1111 1111 1112 failed",
  "Did I spend more than ZMW 1,234.50 or K5000 between 2026-11-01 and 17/11/2026, over 30 days?",
  "On 07.11.2026 12:30 I paid K 1 250.00 for 2 items",
  "I owe ZMW 250 000 by 2026-12-31",
  // Astra r5 false positives
  "Years: 2023 2024 2025 2026",
  "ZMW 123456.78 - 9 transactions",
  "K 123456.78 - 9 items",
  "$123456.78 - 9 payments",
  // Coordinator ruling after r6: strict ISO dates end a digit run
  "Compare spending for 2026-01-01 2026-02-01.",
  "Dates 2025-12-01 2026-01-01 2026-02-01",
  "Compare 2026/01/01 2026/02/01 please", // "/" now joins runs; dates still break them
  // Coordinator ruling after r7: thousands separators never join a run
  "Spent 1,234.50, 2,000.00, 3,500.00 and 4,100.00 last month",
  "K1,500,000.00",
  // Fable r8 F10: a card window reaches into a date only through its year
  "Show spending 01/05/2026 - 28/05/2026",
  "Show spending 01.05.2026 - 28.05.2026",
  "Show spending 01-05-2026 - 28-05-2026",
  "Compare 05/11/2026, 12/11/2026, 19/11/2026",
  "2026-01-16 4500.00\n2026-02-16 4500.00\n2026-03-16 4500.00",
  "Loan 5200 2026-01-15 2026-02-15 2026-03-15",
  "Salary 45000, 52000, 61000",
  // Fable r8 F11: a date and a time are never a landline
  "02-12-2026 15:30 paid K500",
];

describe("Astra r5 the genuine identifiers next to the false positives still redact", () => {
  it.each([
    ["dotted NRC", "NRC 123456.78.9", "nrc"],
    ["dashed NRC", "My NRC is 123456 - 78 - 9", "nrc"],
    ["year list followed by a card", "Years: 2023 2024 then card 4111 1111 1111 1111", "card"],
  ] as const)("%s", (_label, text, kind) => {
    expect(redactOutboundText(text).counts[kind]).toBe(1);
  });
});

describe("Astra r3/r4 identifiers are redacted wherever they appear", () => {
  it.each(MUST_REDACT)("current message: %s", (_label, text, kind, leaked) => {
    const result = redactOutboundText(text);
    expect(result.counts[kind]).toBeGreaterThan(0);
    expect(result.text).not.toContain(leaked);
  });

  it.each(MUST_REDACT)("prior assistant turn: %s", (_label, text, kind, leaked) => {
    const result = redactOutbound("what about it?", [
      { role: "user", text: "remind me" },
      { role: "model", text },
    ]);
    expect(result.counts[kind]).toBeGreaterThan(0);
    expect(result.priorTurns[1].text).not.toContain(leaked);
    expect(result.redacted).toBe(true);
  });
});

describe("Astra r3/r4 amounts and dates stay intact", () => {
  it.each(MUST_STAY_INTACT)("%s", (text) => {
    const result = redactOutboundText(text);
    expect(result.text).toBe(text);
    expect(Object.values(result.counts).every((count) => count === 0)).toBe(true);
  });
});

describe("the matching copy maps placeholders back to the sent text", () => {
  it("normalises dashes and whitespace runs without changing the surrounding text", () => {
    const source = "a–b \n\t c";
    const copy = buildMatchingCopy(source);
    expect(copy.text).toBe("a-b c");
    expect(copy.starts).toEqual([0, 1, 2, 3, 7]);
    expect(copy.ends).toEqual([1, 2, 3, 7, 8]);
  });

  it("keeps the original line breaks and wording around a redacted span", () => {
    const result = redactOutboundText("Hi,\n\nmy card is 4111\n1111 1111 1111.\nThanks – Thandi user");
    expect(result.text).toBe("Hi,\n\nmy card is [card].\nThanks – Thandi user");
    expect(result.counts.card).toBe(1);
  });

  it("redacts several identifiers of different kinds in one text", () => {
    const result = redactOutboundText("NRC 123456–78–9, card 4111 1111-1111 1111, ring 021 123 4567");
    expect(result.text).toBe("NRC [nrc], card [card], ring [phone]");
    expect(result.counts).toMatchObject({ nrc: 1, card: 1, phone: 1 });
  });
});

describe("card rule: 13-19 digits, Luhn-valid, a real issuer range", () => {
  it.each([
    ["4111111111111111", true], // Visa
    ["4222222222222", true], // Visa 13
    ["378282246310005", true], // Amex 37
    ["5555555555554444", true], // Mastercard 51-55
    ["2223003122003222", true], // Mastercard 2-series
    ["30569309025904", true], // Diners 30[0-5]
    ["3530111333300000", true], // JCB 3528-3589
    ["6011111111111117", true], // Discover 6011
    ["4111111111111112", false], // Luhn fails
    ["1000200030004", false], // Luhn passes, but no issuer starts with 1
    ["2023202420252026", false], // a year list: 2023 is below 2221
    ["411111111111", false], // 12 digits
  ] as const)("%s -> %s", (digits, expected) => {
    expect(isCardNumber(digits)).toBe(expected);
  });
});
