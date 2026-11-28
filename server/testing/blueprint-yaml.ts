/**
 * A strict parser for the block-YAML subset the Render blueprint uses
 * (render.yaml), so tests read its structure instead of matching substrings
 * (OPS-003). No YAML library is installed, and this one fails closed: flow
 * collections, anchors, aliases, tags, block scalars, multi-document streams,
 * tab indentation, escapes in quoted strings and duplicate keys all throw,
 * rather than being read as something else.
 *
 * Scalars are typed as YAML 1.2 reads them: a plain true/false is a boolean,
 * a plain integer a number, and anything quoted or otherwise plain a string,
 * so `value: "true"` and `value: true` stay distinct.
 */
export type YamlScalar = string | number | boolean;
export type YamlValue = YamlScalar | YamlMap | readonly YamlValue[];
export interface YamlMap { readonly [key: string]: YamlValue }

interface Line { readonly indent: number; readonly text: string; readonly isItem: boolean; readonly lineNo: number }

const KEY_VALUE = /^([A-Za-z_][A-Za-z0-9_-]*):(?:[ ]+(.*))?$/;
const UNSUPPORTED_START = /^[[{&*!|>%@`]/;

function stripComment(text: string): string {
  let quote: string | null = null;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quote) { if (char === quote) quote = null; continue; }
    if (char === '"' || char === "'") quote = char;
    else if (char === "#" && (i === 0 || text[i - 1] === " ")) return text.slice(0, i).trimEnd();
  }
  return text.trimEnd();
}

/** Each "- rest" line becomes an item marker followed by "rest" two columns in. */
function tokenize(source: string): Line[] {
  const lines: Line[] = [];
  source.split(/\r?\n/).forEach((raw, index) => {
    const lineNo = index + 1;
    const indent = raw.length - raw.trimStart().length;
    if (raw.slice(0, indent).includes("\t")) throw new Error(`line ${lineNo}: tab indentation`);
    const text = stripComment(raw.trimStart());
    if (text === "") return;
    if (text === "---" || text === "...") throw new Error(`line ${lineNo}: multi-document streams are not supported`);
    if (text === "-" || text.startsWith("- ")) {
      lines.push({ indent, text: "-", isItem: true, lineNo });
      const rest = text.slice(1).trimStart();
      if (rest !== "") lines.push({ indent: indent + 2, text: rest, isItem: false, lineNo });
      return;
    }
    lines.push({ indent, text, isItem: false, lineNo });
  });
  return lines;
}

function scalar(text: string, lineNo: number): YamlScalar {
  if (UNSUPPORTED_START.test(text)) throw new Error(`line ${lineNo}: unsupported value ${text}`);
  const quote = text[0];
  if (quote === '"' || quote === "'") {
    if (text.length < 2 || text[text.length - 1] !== quote) throw new Error(`line ${lineNo}: unterminated string`);
    const body = text.slice(1, -1);
    if (body.includes(quote) || body.includes("\\")) throw new Error(`line ${lineNo}: escapes are not supported`);
    return body;
  }
  if (text === "true" || text === "false") return text === "true";
  if (/^-?(0|[1-9][0-9]*)$/.test(text)) return Number(text);
  if (/^(null|~|yes|no|on|off)$/i.test(text)) throw new Error(`line ${lineNo}: ambiguous plain value ${text}; quote it`);
  if (text.includes(": ") || text.endsWith(":")) throw new Error(`line ${lineNo}: nested mapping on one line`);
  return text;
}

class Parser {
  private index = 0;

  constructor(private readonly lines: readonly Line[]) {}

  parseDocument(): YamlValue {
    if (this.lines.length === 0) throw new Error("empty document");
    const value = this.block(this.lines[0].indent);
    if (this.index < this.lines.length) throw new Error(`line ${this.lines[this.index].lineNo}: unexpected indentation`);
    return value;
  }

  private block(indent: number): YamlValue {
    return this.lines[this.index].isItem ? this.sequence(indent) : this.mapping(indent);
  }

  private sequence(indent: number): YamlValue[] {
    const items: YamlValue[] = [];
    while (this.peek(indent)?.isItem) {
      const marker = this.lines[this.index++];
      const next = this.lines[this.index];
      if (!next || next.indent <= indent) throw new Error(`line ${marker.lineNo}: empty sequence item`);
      const isScalarItem = next.lineNo === marker.lineNo && !next.isItem && !KEY_VALUE.test(next.text);
      if (isScalarItem) { this.index++; items.push(scalar(next.text, next.lineNo)); continue; }
      items.push(this.block(next.indent));
    }
    return items;
  }

  private mapping(indent: number): YamlMap {
    const entries: Record<string, YamlValue> = {};
    for (let line = this.peek(indent); line && !line.isItem; line = this.peek(indent)) {
      const match = KEY_VALUE.exec(line.text);
      if (!match) throw new Error(`line ${line.lineNo}: expected "key: value", found ${line.text}`);
      const [, key, rest] = match;
      if (Object.hasOwn(entries, key)) throw new Error(`line ${line.lineNo}: duplicate key ${key}`);
      this.index++;
      if (rest !== undefined && rest !== "") { entries[key] = scalar(rest, line.lineNo); continue; }
      const child = this.lines[this.index];
      if (!child || child.indent <= indent) throw new Error(`line ${line.lineNo}: ${key} has no value`);
      entries[key] = this.block(child.indent);
    }
    return Object.freeze(entries);
  }

  /** The next line if it sits exactly at `indent`; deeper lines here are an error. */
  private peek(indent: number): Line | undefined {
    const line = this.lines[this.index];
    if (!line || line.indent < indent) return undefined;
    if (line.indent > indent) throw new Error(`line ${line.lineNo}: unexpected indentation`);
    return line;
  }
}

export function parseBlockYaml(source: string): YamlValue {
  return new Parser(tokenize(source)).parseDocument();
}
