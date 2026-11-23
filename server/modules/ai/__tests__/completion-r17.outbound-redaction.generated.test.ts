/**
 * R17 #246 Fable r7: generated leak test for outbound card redaction.
 *
 * Instead of one row per reported input, every Luhn-valid card below is
 * written in every joiner, grouping, script, invisible-mark, date and glue
 * form, and the redacted text must hold neither a 13-19 digit Luhn-valid run
 * nor any 8-digit stretch of the card. That catches the class of leak (a
 * joiner, a neighbour or a script the rules miss), not just the examples.
 */
import { describe, expect, it } from "vitest";

import { CARD_JOINERS, PHONE_JOINERS } from "../ai.outbound-joiners";
import { isLuhnValid, redactOutboundText } from "../ai.outbound-redaction";

/** Complete `body` (all digits but the last) with its Luhn check digit. */
function withCheckDigit(body: string): string {
  const digit = [..."0123456789"].find((candidate) => isLuhnValid(body + candidate));
  if (digit === undefined) throw new Error(`no check digit for ${body}`);
  return body + digit;
}

const FILLER = "4539148803472025617";

/** [issuer prefix, length]: one card per issuer family the rule must cover. */
const ISSUERS: ReadonlyArray<readonly [string, number]> = [
  ["4", 13], ["4", 16], ["4", 19], ["51", 16], ["55", 16], ["2221", 16], ["2720", 16],
  ["34", 15], ["37", 15], ["300", 14], ["36", 14], ["38", 14], ["3528", 16], ["3589", 16],
  ["6011", 16], ["65", 16], ["62", 16], ["81", 16], ["82", 16], ["6759", 16], ["6304", 16],
  ["5061", 19], ["5019", 16], ["2200", 16],
];

const GENERATED = ISSUERS.map(([prefix, length]) =>
  withCheckDigit(prefix + FILLER.slice(0, length - prefix.length - 1)),
);
/** Real reported cards, including ones whose last group reads as a year. */
const REPORTED = ["4539148803472025", "5555555555501999", "6759649826438453", "5061460410120223210"];
const CARDS = [...GENERATED, ...REPORTED];

const JOINERS = [
  "", " ", ".", "-", "–", "—", "−", " - ", "\n", "/", ",", ", ", "_", ":", "·", "•", "／", "‐ ",
];
const MARKS = ["‎", "‪", "⁦", "͏", "️", "­"];
const SCRIPT_ZEROS = [0x0660, 0x06f0, 0x0966, 0xff10];

/**
 * The printed layout of a card of each length (Fable r8: a joined run's
 * windows follow its groups, so the test writes cards as issuers print them):
 * 13 as 4-4-5, 14 (Diners) as 4-6-4, 15 (Amex) as 4-6-5, 16 as 4-4-4-4 and
 * 19 as 4-4-4-4-3.
 */
const LAYOUTS: Readonly<Record<number, readonly number[]>> = {
  13: [4, 4, 5],
  14: [4, 6, 4],
  15: [4, 6, 5],
  16: [4, 4, 4, 4],
  19: [4, 4, 4, 4, 3],
};

function groupsOf(card: string): string[] {
  const layout = LAYOUTS[card.length];
  if (!layout) throw new Error(`no printed layout for a ${card.length}-digit card`);
  return layout.map((size, index) => {
    const start = layout.slice(0, index).reduce((total, previous) => total + previous, 0);
    return card.slice(start, start + size);
  });
}

function inScript(text: string, zero: number): string {
  return text.replace(/\d/g, (digit) => String.fromCodePoint(zero + Number(digit)));
}

/** Every written form of one card. */
function writtenForms(card: string): string[] {
  const groups = groupsOf(card);
  const joined = JOINERS.map((joiner) => groups.join(joiner));
  const marked = MARKS.map((mark) => groups.join(mark));
  const scripts = SCRIPT_ZEROS.map((zero) => inScript(groups.join(" "), zero));
  return [...joined, ...marked, ...scripts];
}

/** Every context a written card is placed in. */
const GLUE: ReadonlyArray<(card: string) => string> = [
  (card) => card,
  (card) => `card ${card}`,
  (card) => `${card} 123`,
  (card) => `${card}123`,
  (card) => `1. ${card}`,
  (card) => `1.${card}`,
  (card) => `ref ${card} 2025`,
  (card) => `${card} 12/26`,
  (card) => `${card} 12/26 1 item`,
  (card) => `2026-01-01 ${card}`,
  (card) => `${card} 2026-01-28`,
  (card) => `${card}-01-28`,
  (card) => `${card}/01/28`,
  (card) => `${card}@gmail.com`,
  (card) => `paid with ${card} @ Shoprite.Manda Hill`,
  (card) => `{"pan":"${card}"}`,
  (card) => `K 250 then ${card}, thanks`,
  (card) => `x${card}y`,
];

const NATIVE_DIGIT = /\p{Nd}/u;

/** The leftover digits a reader could reassemble: native digits as ASCII, joiners and marks dropped. */
function reassembledRuns(text: string): string[] {
  const ascii = [...text.normalize("NFKC")]
    .map((char) => {
      if (/[0-9]/.test(char)) return char;
      if (!NATIVE_DIGIT.test(char)) return char;
      const zero = SCRIPT_ZEROS.find((start) => {
        const point = char.codePointAt(0) ?? 0;
        return point >= start && point < start + 10;
      });
      return zero === undefined ? char : String((char.codePointAt(0) ?? 0) - zero);
    })
    .join("");
  return ascii.replace(/[\s\p{Pd}−./,_:·•\p{Cf}͏︀-️]/gu, "").match(/\d+/g) ?? [];
}

function hasLuhnWindow(run: string): boolean {
  for (let first = 0; first + 13 <= run.length; first += 1) {
    for (let length = 13; length <= 19 && first + length <= run.length; length += 1) {
      if (isLuhnValid(run.slice(first, first + length))) return true;
    }
  }
  return false;
}

function leakOf(card: string, sent: string): string | null {
  const runs = reassembledRuns(sent);
  const luhnRun = runs.find((run) => run.length >= 13 && hasLuhnWindow(run));
  if (luhnRun) return `Luhn-valid run ${luhnRun}`;
  const joined = runs.join(" ");
  for (let first = 0; first + 8 <= card.length; first += 1) {
    if (joined.includes(card.slice(first, first + 8))) return `card digits ${card.slice(first, first + 8)}`;
  }
  return null;
}

/** Fable r8: identifiers that sit next to a card in a list (phone, NRC, email). */
const NEIGHBOURS: ReadonlyArray<readonly [written: string, digits: string]> = [
  ["0977123456", "0977123456"],
  ["123456/78/1", "123456781"],
  ["kb.0966123456@mail.com", "0966123456"],
];
const NEIGHBOUR_JOINERS = [" ", ", ", "\n", "/", " - "];

function neighbourLeak(digits: string, sent: string): string | null {
  const joined = reassembledRuns(sent).join(" ");
  for (let first = 0; first + 8 <= digits.length; first += 1) {
    if (joined.includes(digits.slice(first, first + 8))) return `neighbour digits ${digits.slice(first, first + 8)}`;
  }
  return null;
}

describe("Fable r7 generated: no written form of a card survives redaction", () => {
  it.each(CARDS)("card %s in every joiner, script, mark, date and glue form", (card) => {
    const leaks = writtenForms(card).flatMap((form) =>
      GLUE.map((glue) => glue(form)).flatMap((input) => {
        const leak = leakOf(card, redactOutboundText(input).text);
        return leak ? [`${JSON.stringify(input)} -> ${leak}`] : [];
      }),
    );
    expect(leaks).toEqual([]);
  });

  it.each(CARDS)("card %s next to a phone, an NRC or an email leaks neither", (card) => {
    const forms = JOINERS.map((joiner) => groupsOf(card).join(joiner));
    const leaks = forms.flatMap((form) =>
      NEIGHBOURS.flatMap(([written, digits]) =>
        NEIGHBOUR_JOINERS.flatMap((joiner) => [`${form}${joiner}${written}`, `${written}${joiner}${form}`]).flatMap((input) => {
          const sent = redactOutboundText(input).text;
          const leak = leakOf(card, sent) ?? neighbourLeak(digits, sent);
          return leak ? [`${JSON.stringify(input)} -> ${leak}`] : [];
        }),
      ),
    );
    expect(leaks).toEqual([]);
  });
});

/**
 * Codex on 6b3123fd3 (P1): a combining mark after any separator a scanner
 * accepts is stripped, so it never splits a digit run. Every card and phone
 * joiner, plus the raw forms the matching copy folds (tab, no-break space,
 * en dash, minus sign), with a mark after the middle separator and after all.
 */
describe("a combining mark after any accepted separator never splits a run", () => {
  const CARD = "4111111111111111";
  const MARKS = ["\u0301", "\u20DD", "\u{E0100}", "\u0301\u0300"];
  const FOLDED = ["\t", "\u00A0", "\u2013", "\u2212"];
  const stretches = (digits: string, size: number) =>
    Array.from({ length: digits.length - size + 1 }, (_, first) => digits.slice(first, first + size));
  const leaked = (sent: string, digits: string, size: number) => {
    const kept = sent.replace(/\D/g, "");
    return stretches(digits, size).filter((stretch) => kept.includes(stretch));
  };
  const groups = (digits: string, sizes: readonly number[]) => {
    let first = 0;
    return sizes.map((size) => digits.slice(first, (first += size)));
  };

  const cardRows = [...CARD_JOINERS, ...FOLDED].flatMap((joiner) =>
    MARKS.flatMap((mark) => {
      const parts = groups(CARD, [4, 4, 4, 4]);
      return [
        [JSON.stringify(joiner), JSON.stringify(mark), "middle", `card ${parts.slice(0, 2).join(joiner)}${joiner}${mark}${parts.slice(2).join(joiner)} ok`],
        [JSON.stringify(joiner), JSON.stringify(mark), "every", `card ${parts.join(joiner + mark)} ok`],
      ] as const;
    }),
  );

  it.each(cardRows)("card joiner %s, mark %s after the %s separator", (_joiner, _mark, _where, text) => {
    const result = redactOutboundText(text);
    expect(result.counts.card).toBeGreaterThan(0);
    expect(leaked(result.text, CARD, 8)).toEqual([]);
  });

  const PHONE = "0971234567";
  const phoneRows = [...PHONE_JOINERS.filter((joiner) => joiner !== "(" && joiner !== ")"), ...FOLDED].flatMap((joiner) =>
    MARKS.map((mark) => [JSON.stringify(joiner), JSON.stringify(mark), `ring ${groups(PHONE, [3, 3, 4]).join(joiner + mark)} now`] as const),
  ).concat(MARKS.flatMap((mark) => [
    ["\"(\" and \")\"", JSON.stringify(mark), `ring (${mark}097)${mark} 123 4567 now`] as const,
  ]));

  it.each(phoneRows)("phone joiner %s, mark %s after every separator", (_joiner, _mark, text) => {
    const result = redactOutboundText(text);
    expect(result.counts.phone + result.counts.card).toBeGreaterThan(0);
    expect(leaked(result.text, PHONE, 6)).toEqual([]);
  });
});

/**
 * Follow-up to ceea0d1a1: "+" is back in the mark strip. A "+" that prefixes
 * a number after a list separator, with a mark after it, no longer leaves
 * "+\u0301" outside the placeholder. "+" stays a phone prefix only: it never
 * joins card groups, and sums or signed amounts are left alone.
 */
describe("a combining mark after a \"+\" inside a digit run is stripped", () => {
  const MARKS = ["\u0301", "\u20DD", "\u{E0100}"];
  const rows = MARKS.flatMap((mark) => [
    [JSON.stringify(mark), `0977123456,+${mark}260971234567`, "[phone],[phone]"],
    [JSON.stringify(mark), `0977123456 / +${mark}260 97 123 4567`, "[phone] / [phone]"],
    [JSON.stringify(mark), `pay 500 +${mark}260 97 123 4567`, "pay 500 [phone]"],
    [JSON.stringify(mark), `4111 1111 1111 1111 +${mark}260 97 123 4567`, "[card] [phone]"],
  ] as const);

  it.each(rows)("mark %s: %j", (_mark, text, sent) => {
    expect(redactOutboundText(text).text).toBe(sent);
  });

  it.each([
    ["+260 97 123 4567", "[phone]", "phone"],
    ["call +260971234567 today", "call [phone] today", "phone"],
  ] as const)("%j is still a phone, never a card", (text, sent, kind) => {
    const result = redactOutboundText(text);
    expect(result.text).toBe(sent);
    expect(result.counts[kind]).toBe(1);
    expect(result.counts.card).toBe(0);
  });

  it.each(["Total 1500+2500+3500+4500", "My balance changed by +12345.67", "K500+K250+K100"])("%j is unchanged", (text) => {
    expect(redactOutboundText(text).text).toBe(text);
  });
});
