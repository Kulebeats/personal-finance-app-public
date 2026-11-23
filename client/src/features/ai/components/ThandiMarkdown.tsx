/**
 * ThandiMarkdown — renders an answer's formatting (bold, lists, tables) the
 * way Claude writes it.
 *
 * Safe by construction: react-markdown builds React elements and never
 * inserts HTML, `skipHtml` drops any raw HTML in the answer, and links render
 * as plain text so an answer can never send the user somewhere. Images are
 * never rendered: `![x](https://...)` would make the browser fetch that URL,
 * which could carry data out (#301 review).
 */
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

/** Elements dropped from an answer, with everything inside them. */
const DISALLOWED_ELEMENTS = ["img"];

const COMPONENTS: Components = {
  p: ({ children }) => <p className="leading-relaxed [&:not(:first-child)]:mt-2">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  ul: ({ children }) => <ul className="mt-2 list-disc space-y-1 pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="mt-2 list-decimal space-y-1 pl-5">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  h1: ({ children }) => <p className="mt-3 font-semibold first:mt-0">{children}</p>,
  h2: ({ children }) => <p className="mt-3 font-semibold first:mt-0">{children}</p>,
  h3: ({ children }) => <p className="mt-3 font-semibold first:mt-0">{children}</p>,
  a: ({ children }) => <span className="underline decoration-dotted">{children}</span>,
  code: ({ children }) => <code className="rounded bg-background/60 px-1 py-0.5 text-[0.85em]">{children}</code>,
  table: ({ children }) => (
    <div className="mt-2 overflow-x-auto rounded-md border border-border">
      <table className="w-full border-collapse text-left text-sm">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-background/60">{children}</thead>,
  th: ({ children }) => <th className="border-b border-border px-3 py-1.5 font-semibold">{children}</th>,
  td: ({ children }) => <td className="border-t border-border px-3 py-1.5 tabular-nums">{children}</td>,
};

interface ThandiMarkdownProps {
  content: string;
}

export function ThandiMarkdown({ content }: ThandiMarkdownProps) {
  return (
    <div className="break-words">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={COMPONENTS} disallowedElements={DISALLOWED_ELEMENTS} skipHtml>
        {content}
      </ReactMarkdown>
    </div>
  );
}
