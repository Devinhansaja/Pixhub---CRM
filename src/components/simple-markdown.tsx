import Link from "next/link";
import { Fragment } from "react";

/**
 * Tiny, safe renderer for assistant replies: paragraphs, bullet lists, **bold**,
 * and [text](/internal-path) links. No HTML is ever injected; only internal links render.
 */
function inline(text: string, key: string) {
  const parts: React.ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*|\[([^\]]+)\]\((\/[^)\s]*)\)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    if (m[1]) parts.push(<strong key={`${key}-${i++}`}>{m[1]}</strong>);
    else parts.push(<Link key={`${key}-${i++}`} href={m[3]} className="text-brand-600 underline">{m[2]}</Link>);
    last = re.lastIndex;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

export function SimpleMarkdown({ text }: { text: string }) {
  const blocks = text.replace(/\r/g, "").split(/\n{2,}/);
  return (
    <div className="space-y-2">
      {blocks.map((b, bi) => {
        const lines = b.split("\n");
        if (lines.every((l) => /^\s*([-*•]|\d+\.)\s+/.test(l))) {
          return (
            <ul key={bi} className="list-disc space-y-1 pl-5">
              {lines.map((l, li) => <li key={li}>{inline(l.replace(/^\s*([-*•]|\d+\.)\s+/, ""), `${bi}-${li}`)}</li>)}
            </ul>
          );
        }
        const heading = /^#{1,4}\s+(.*)$/.exec(lines[0]);
        return (
          <p key={bi} className={heading ? "font-semibold" : ""}>
            {lines.map((l, li) => (
              <Fragment key={li}>{li > 0 && <br />}{inline(heading && li === 0 ? heading[1] : l, `${bi}-${li}`)}</Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}
