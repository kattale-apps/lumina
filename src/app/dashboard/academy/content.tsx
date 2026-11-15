import type { ReactNode } from "react";

/**
 * Lesson text is plain text with two conventions: a line starting with "## "
 * is a sub-heading, and consecutive lines starting with "- " are a bulleted
 * list. A blank line starts a new paragraph. Nothing is rendered as HTML.
 */
export function LessonBody({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let bullets: string[] = [];
  let para: string[] = [];
  const flush = () => {
    if (bullets.length) {
      blocks.push(<ul key={blocks.length}>{bullets.map((b, i) => <li key={i}>{b}</li>)}</ul>);
      bullets = [];
    }
    if (para.length) {
      blocks.push(<p key={blocks.length}>{para.join(" ")}</p>);
      para = [];
    }
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) flush();
    else if (line.startsWith("## ")) {
      flush();
      blocks.push(<h4 key={blocks.length}>{line.slice(3)}</h4>);
    } else if (line.startsWith("- ")) {
      if (para.length) flush();
      bullets.push(line.slice(2));
    } else {
      if (bullets.length) flush();
      para.push(line);
    }
  }
  flush();
  return <div className="lesson-body">{blocks}</div>;
}

/** The player address for a YouTube or Vimeo link, or null when the link is to something else. */
export function embedUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  const host = url.hostname.replace(/^www\.|^m\./, "");
  const id = /^[\w-]{6,20}$/;
  if (host === "youtu.be") {
    const v = url.pathname.slice(1).split("/")[0];
    return id.test(v) ? `https://www.youtube-nocookie.com/embed/${v}` : null;
  }
  if (host === "youtube.com" || host === "youtube-nocookie.com") {
    const parts = url.pathname.split("/").filter(Boolean);
    const v = url.pathname === "/watch" ? url.searchParams.get("v") ?? "" : ["embed", "shorts", "live"].includes(parts[0]) ? parts[1] ?? "" : "";
    return id.test(v) ? `https://www.youtube-nocookie.com/embed/${v}` : null;
  }
  if (host === "vimeo.com" || host === "player.vimeo.com") {
    const v = url.pathname.split("/").filter(Boolean).pop() ?? "";
    return /^\d{6,12}$/.test(v) ? `https://player.vimeo.com/video/${v}` : null;
  }
  return null;
}

export function LessonVideo({ url, title }: { url: string; title: string }) {
  const src = embedUrl(url);
  if (!src) {
    return (
      <p>
        <a className="button button-small button-secondary" href={url} target="_blank" rel="noreferrer">▶ Watch the video</a>
      </p>
    );
  }
  return (
    <div className="lesson-video">
      <iframe
        src={src}
        title={`Video: ${title}`}
        loading="lazy"
        allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen"
        allowFullScreen
        referrerPolicy="strict-origin-when-cross-origin"
      />
    </div>
  );
}
