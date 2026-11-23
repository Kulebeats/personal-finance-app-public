/**
 * R17 #246 Fable r8: the two-sided generated check for outbound redaction.
 *
 * Leak side: lists of identifiers written next to each other (phones, an NRC
 * then phones) in every list joiner must not send any 6-digit stretch of any
 * of them (F9: a false card window used to eat part of one number and leave
 * the rest unmatched).
 * Over-redaction side: ordinary spending text built from seeded random dates
 * and amounts. Date ranges, date lists and dated amount lines must never
 * change (F10, F11). Amount lists may change only in a bounded share of
 * inputs (the accepted residual: some pass issuer + Luhn); the ceilings sit
 * at about twice the rates Fable r9 measured, so a doubling fails (r10).
 * r10 (F14): phones come in the 0, 260 and bare 9-digit forms, also inside
 * CSV rows and next to amounts.
 */
import { describe, expect, it } from "vitest";

import { redactOutboundText } from "../ai.outbound-redaction";

const SAMPLES = 400;
const STRETCH = 6;

/** Deterministic PRNG (mulberry32) so a failure always reproduces. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

function digitsOf(random: () => number, count: number): string {
  return Array.from({ length: count }, () => Math.floor(random() * 10)).join("");
}

function pick<T>(random: () => number, items: readonly T[]): T {
  return items[Math.floor(random() * items.length)];
}

function between(random: () => number, low: number, high: number): number {
  return low + Math.floor(random() * (high - low + 1));
}

const pad = (value: number) => String(value).padStart(2, "0");

function phone(random: () => number): string {
  const national = `${pick(random, ["95", "96", "97", "76", "77"])}${digitsOf(random, 7)}`;
  return `${pick(random, ["0", "260", ""])}${national}`;
}

function nrc(random: () => number): { written: string; digits: string } {
  const six = digitsOf(random, 6);
  const two = digitsOf(random, 2);
  const one = digitsOf(random, 1);
  return { written: `${six}/${two}/${one}`, digits: six + two + one };
}

function isoDate(random: () => number): string {
  return `${between(random, 2020, 2027)}-${pad(between(random, 1, 12))}-${pad(between(random, 1, 28))}`;
}

function dayFirstDate(random: () => number, separator: string): string {
  return [pad(between(random, 1, 28)), pad(between(random, 1, 12)), between(random, 2020, 2027)].join(separator);
}

function amount(random: () => number, digits: number): string {
  return String(between(random, 10 ** (digits - 1), 10 ** digits - 1));
}

/** Every digit run left in the sent text, joiners dropped, for reassembly. */
function sentDigits(text: string): string {
  return text.replace(/[\s\-./,_:·•()]/g, "").match(/\d+/g)?.join(" ") ?? "";
}

function leakedStretch(identifiers: readonly string[], sent: string): string | null {
  const digits = sentDigits(sent);
  for (const identifier of identifiers) {
    for (let first = 0; first + STRETCH <= identifier.length; first += 1) {
      const stretch = identifier.slice(first, first + STRETCH);
      if (digits.includes(stretch)) return stretch;
    }
  }
  return null;
}

const LIST_JOINERS = [", ", ",", "/", " / ", " ", "\n", " - ", "; "];

describe("Fable r8 leak side: identifiers written next to each other", () => {
  const shapes: ReadonlyArray<[string, (random: () => number, joiner: string) => { text: string; ids: string[] }]> = [
    ["two phones", (random, joiner) => {
      const ids = [phone(random), phone(random)];
      return { text: ids.join(joiner), ids };
    }],
    ["three phones", (random, joiner) => {
      const ids = [phone(random), phone(random), phone(random)];
      return { text: `Call ${ids.join(joiner)}`, ids };
    }],
    ["an NRC then a phone", (random, joiner) => {
      const id = nrc(random);
      const number = phone(random);
      return { text: `NRC ${id.written}${joiner}${number}`, ids: [id.digits.slice(0, 6), number] };
    }],
    ["a payment row: name, phone, amount", (random, joiner) => {
      const number = phone(random);
      return { text: [pick(random, ["John Banda", "M. Phiri"]), number, `${amount(random, 3)}.00`].join(joiner), ids: [number] };
    }],
    ["an amount then a phone", (random, joiner) => {
      const number = phone(random);
      return { text: `${pick(random, ["K", ""])}${amount(random, between(random, 1, 4))}${joiner}${number}`, ids: [number] };
    }],
    ["a phone then an amount", (random, joiner) => {
      const number = phone(random);
      return { text: `${number}${joiner}${amount(random, between(random, 1, 4))}${pick(random, ["", ".00"])}`, ids: [number] };
    }],
    ["an NRC then two phones", (random, joiner) => {
      const id = nrc(random);
      const numbers = [phone(random), phone(random)];
      return { text: [id.written, ...numbers].join(joiner), ids: [id.digits.slice(0, 6), ...numbers] };
    }],
  ];

  it.each(shapes)("%s in every list joiner sends no 6-digit stretch of any of them", (_label, build) => {
    const random = seeded(246_008);
    const leaks = LIST_JOINERS.flatMap((joiner) =>
      Array.from({ length: SAMPLES / 4 }, () => build(random, joiner)).flatMap(({ text, ids }) => {
        const sent = redactOutboundText(text).text;
        const stretch = leakedStretch(ids, sent);
        return stretch ? [`${JSON.stringify(text)} -> ${JSON.stringify(sent)} (${stretch})`] : [];
      }),
    );
    expect(leaks).toEqual([]);
  });
});

function changedShare(build: (random: () => number) => string, seed: number): { share: number; examples: string[] } {
  const random = seeded(seed);
  const inputs = Array.from({ length: SAMPLES }, () => build(random));
  const changed = inputs.filter((text) => redactOutboundText(text).text !== text);
  return { share: changed.length / inputs.length, examples: changed.slice(0, 3) };
}

describe("Fable r8 over-redaction side: ordinary spending text", () => {
  const mustNeverChange: ReadonlyArray<[string, (random: () => number) => string]> = [
    ...["/", "-", "."].map((separator) => [
      `a DD${separator}MM${separator}YYYY range`,
      (random: () => number) => `Show spending ${dayFirstDate(random, separator)} - ${dayFirstDate(random, separator)}`,
    ] as [string, (random: () => number) => string]),
    ["three DD/MM/YYYY dates", (random) => [1, 2, 3].map(() => dayFirstDate(random, "/")).join(", ")],
    ["three ISO date + amount lines", (random) => [1, 2, 3].map(() => `${isoDate(random)} ${amount(random, 4)}.00`).join("\n")],
    ["five ISO date + merchant + amount lines", (random) =>
      [1, 2, 3, 4, 5].map(() => `${isoDate(random)} ${pick(random, ["Shoprite", "Pick n Pay", "Zesco", "Total"])} ${amount(random, 4)}.00`).join("\n")],
    ["an amount then ISO dates", (random) => `Loan ${amount(random, 4)} ${isoDate(random)} ${isoDate(random)} ${isoDate(random)}`],
    ["a DD-MM-YYYY date and a time", (random) => `${dayFirstDate(random, "-")} ${pad(between(random, 0, 23))}:${pad(between(random, 0, 59))} paid K${amount(random, 3)}`],
  ];

  it.each(mustNeverChange)("%s is never changed", (_label, build) => {
    const { share, examples } = changedShare(build, 246_010);
    expect({ share, examples }).toEqual({ share: 0, examples: [] });
  });

  const ceilings: ReadonlyArray<[string, number, number, string, number]> = [
    // label, items, digits per amount, joiner, ceiling (about 2x Fable r9's measured rate)
    ["four 4-digit amounts, comma-space", 4, 4, ", ", 0.1],
    ["four 4-digit amounts, spaces", 4, 4, " ", 0.1],
    ["three 5-digit amounts, comma-space", 3, 5, ", ", 0.2],
    ["three 5-digit amounts, slashes", 3, 5, "/", 0.2],
    ["six 4-digit amounts, comma-space", 6, 4, ", ", 0.25],
  ];

  it.each(ceilings)("a list of %s changes in at most the ceiling share of inputs", (_label, items, digits, joiner, ceiling) => {
    const { share } = changedShare(
      (random) => Array.from({ length: items }, () => amount(random, digits)).join(joiner),
      246_011 + items * 10 + digits,
    );
    expect(share).toBeLessThanOrEqual(ceiling);
  });
});
