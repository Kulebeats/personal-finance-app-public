/**
 * ReDoS-safe regex compilation.
 *
 * User-supplied patterns (today: transaction rule conditions) are compiled with
 * the JavaScript engine, which is backtracking-based. A syntactically VALID
 * pattern can still take exponential time: `(a+)+$` against 25 non-matching
 * characters blocks Node's single event loop for ~20 seconds, denying service
 * to every household on the instance.
 *
 * Approach: reject pathological patterns statically (a linear scan for
 * unbounded nesting) rather than trying to interrupt a running match.
 *
 *  - A `vm` timeout cannot preempt a synchronous regex - the engine never
 *    yields to the interrupt - so it does not solve this at all.
 *  - A worker-thread timeout would work, but it puts a thread hop on a path
 *    that runs once per condition per transaction, over an unbounded
 *    apply-to-past batch.
 *  - RE2 gives the strongest guarantee, but it is a native addon (node-gyp on
 *    CI and on the deploy target) and drops backreferences and lookaround,
 *    which would silently break already-stored patterns that use them.
 *
 * The scan below is O(pattern length), needs no dependency, and is deliberately
 * conservative: it may reject an exotic pattern that happens to be safe, which
 * for a rule-matching feature is the right trade.
 *
 * @module core/safeRegex
 */

/**
 * Hard cap on pattern length, independent of structure. Bounds both scan cost
 * and the constant factors of any pattern that passes the structural check.
 */
export const MAX_REGEX_PATTERN_LENGTH = 200;

/**
 * Cap on open-ended repetitions in one pattern.
 *
 * Side-by-side quantifiers over overlapping character sets - `\d+\d+\d+...` -
 * backtrack polynomially with degree equal to the number of siblings, needing
 * no nesting at all, so the structural nesting check above cannot see them.
 * Within the 200-character cap an attacker could otherwise fit ~60 of them.
 * Four keeps the worst case near n^4 on a bounded subject while still allowing
 * ordinary patterns (`.*a.*b.*`, `^\w+\s+\d+$`).
 */
export const MAX_UNBOUNDED_QUANTIFIERS = 4;

export type RegexSafetyResult =
  | { safe: true }
  | { safe: false; reason: string };

/** Tracks what has been seen inside the group currently being scanned. */
type GroupFrame = {
  /** A `*`, `+`, or open-ended `{n,}` was applied to something in this group. */
  hasUnboundedQuantifier: boolean;
  /** A top-level `|` in this group - branches may overlap, e.g. `(a|a)`. */
  hasAlternation: boolean;
};

type Quantifier = {
  /** Index just past the quantifier (and any lazy/possessive `?`/`+` suffix). */
  end: number;
  /** True when the quantifier permits unboundedly many repetitions. */
  unbounded: boolean;
};

const BOUNDED_REPEAT = /^\{(\d+)(,(\d*))?\}/;

/**
 * Read a quantifier starting at `index`, if one is there.
 *
 * `?` and `{0,1}` are bounded: they cannot drive exponential backtracking on
 * their own, so a group carrying only those is not treated as nested.
 */
function readQuantifier(pattern: string, index: number): Quantifier | null {
  const char = pattern[index];
  if (char === undefined) return null;

  let end = index;
  let unbounded: boolean;

  if (char === "*" || char === "+") {
    unbounded = true;
    end = index + 1;
  } else if (char === "?") {
    unbounded = false;
    end = index + 1;
  } else if (char === "{") {
    const match = BOUNDED_REPEAT.exec(pattern.slice(index));
    if (!match) return null; // A literal `{`, not a repetition.
    const hasComma = match[2] !== undefined;
    const maxRaw = match[3];
    const max =
      maxRaw === undefined || maxRaw === "" ? Infinity : Number(maxRaw);
    // An EXACT count (`{4}`) is deterministic - it matches exactly n times and
    // offers the engine no choice, so it cannot drive backtracking. Only a
    // range that permits more than one repetition count is ambiguous.
    unbounded = hasComma && max > 1;
    end = index + match[0].length;
  } else {
    return null;
  }

  // Consume a lazy (`?`) or possessive (`+`) modifier. Lazy matching changes
  // the order the engine explores, not the size of the search space.
  if (pattern[end] === "?" || pattern[end] === "+") end += 1;

  return { end, unbounded };
}

/**
 * Return the index just past a group's opening prefix: `(`, `(?:`, `(?=`,
 * `(?!`, `(?<=`, `(?<!`, or `(?<name>`.
 */
function skipGroupPrefix(pattern: string, index: number): number {
  let i = index + 1;
  if (pattern[i] !== "?") return i;

  if (pattern[i + 1] === "<" && pattern[i + 2] !== "=" && pattern[i + 2] !== "!") {
    const close = pattern.indexOf(">", i);
    return close === -1 ? i + 2 : close + 1;
  }
  // Lookbehind `?<=` / `?<!` is three characters; `?:` / `?=` / `?!` are two.
  return pattern[i + 1] === "<" ? i + 3 : i + 2;
}

/** Return the index just past a character class starting at `[`. */
function skipCharacterClass(pattern: string, index: number): number {
  let i = index + 1;
  if (pattern[i] === "^") i += 1;
  if (pattern[i] === "]") i += 1; // A leading `]` is a literal.
  while (i < pattern.length) {
    if (pattern[i] === "\\") {
      i += 2;
      continue;
    }
    if (pattern[i] === "]") return i + 1;
    i += 1;
  }
  return pattern.length;
}

/**
 * Decide whether a pattern is safe to run against untrusted input.
 *
 * Rejects, in order: over-length patterns, invalid syntax, any group repeated
 * unboundedly while containing (at any depth) an unbounded quantifier or an
 * alternation, and finally patterns carrying more than
 * `MAX_UNBOUNDED_QUANTIFIERS` open-ended repetitions.
 *
 * The first two shapes - `(a+)+` and `(a|a)*` - make the number of backtracking
 * paths exponential in the input length; the last makes it polynomial with
 * degree equal to the sibling count.
 */
export function checkRegexSafety(pattern: string): RegexSafetyResult {
  if (pattern.length > MAX_REGEX_PATTERN_LENGTH) {
    return {
      safe: false,
      reason: `Pattern must be at most ${MAX_REGEX_PATTERN_LENGTH} characters`,
    };
  }

  try {
    new RegExp(pattern);
  } catch {
    return { safe: false, reason: "Pattern is not a valid regular expression" };
  }

  const stack: GroupFrame[] = [
    { hasUnboundedQuantifier: false, hasAlternation: false },
  ];
  let index = 0;
  let unboundedCount = 0;

  while (index < pattern.length) {
    const char = pattern[index];
    const frame = stack[stack.length - 1];

    if (char === "(") {
      stack.push({ hasUnboundedQuantifier: false, hasAlternation: false });
      index = skipGroupPrefix(pattern, index);
      continue;
    }

    if (char === ")") {
      const closed = stack.length > 1 ? stack.pop() : undefined;
      index += 1;
      const quantifier = readQuantifier(pattern, index);
      if (quantifier) index = quantifier.end;
      if (!closed) continue;

      if (quantifier?.unbounded) {
        unboundedCount += 1;
        if (closed.hasUnboundedQuantifier) {
          return {
            safe: false,
            reason:
              "Pattern nests one unbounded repetition inside another (for example `(a+)+`), which can backtrack exponentially",
          };
        }
        if (closed.hasAlternation) {
          return {
            safe: false,
            reason:
              "Pattern repeats a group containing alternation (for example `(a|a)*`), which can backtrack exponentially",
          };
        }
      }

      // Propagate UNCONDITIONALLY. A group's dangerous interior does not stop
      // being dangerous just because this particular group is unquantified -
      // an ancestor group may still repeat it. Gating this merge on the group
      // being quantified is what lets `((a+))+` slip past a `(a+)+` check.
      const parent = stack[stack.length - 1];
      parent.hasUnboundedQuantifier =
        parent.hasUnboundedQuantifier ||
        closed.hasUnboundedQuantifier ||
        quantifier?.unbounded === true;
      parent.hasAlternation = parent.hasAlternation || closed.hasAlternation;
      continue;
    }

    if (char === "|") {
      frame.hasAlternation = true;
      index += 1;
      continue;
    }

    // A single atom: an escape (`\d`), a character class (`[a-z]`), or any
    // other single character (`.`, a literal, an anchor).
    index =
      char === "\\"
        ? index + 2
        : char === "["
          ? skipCharacterClass(pattern, index)
          : index + 1;

    const quantifier = readQuantifier(pattern, index);
    if (quantifier) {
      index = quantifier.end;
      if (quantifier.unbounded) {
        frame.hasUnboundedQuantifier = true;
        unboundedCount += 1;
      }
    }
  }

  if (unboundedCount > MAX_UNBOUNDED_QUANTIFIERS) {
    return {
      safe: false,
      reason: `Pattern uses more than ${MAX_UNBOUNDED_QUANTIFIERS} open-ended repetitions (\`*\`, \`+\`, \`{n,}\`), which can match in quadratically many ways`,
    };
  }

  return { safe: true };
}

/**
 * Compile a user-supplied pattern, or return `null` if it is unsafe or invalid.
 *
 * Callers on a matching path should treat `null` as "does not match" rather
 * than throwing - a stored rule created before this check existed must not
 * break the whole batch.
 */
export function compileSafeRegex(pattern: string, flags = ""): RegExp | null {
  if (!checkRegexSafety(pattern).safe) return null;
  try {
    return new RegExp(pattern, flags);
  } catch {
    return null;
  }
}
