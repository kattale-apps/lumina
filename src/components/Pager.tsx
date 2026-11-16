"use client";

/** Page-at-a-time controls for long lists. Hidden when everything fits on one page. */
export function Pager({
  page,
  pageCount,
  onPage,
  labels = { previous: "Previous", next: "Next", status: (p: number, n: number) => `Page ${p} of ${n}` }
}: {
  page: number;
  pageCount: number;
  onPage: (page: number) => void;
  labels?: { previous: string; next: string; status: (page: number, pageCount: number) => string };
}) {
  if (pageCount <= 1) return null;
  return (
    <nav className="pager" aria-label={labels.status(page, pageCount)}>
      <button type="button" className="button button-secondary button-small" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        {labels.previous}
      </button>
      <span className="muted" aria-live="polite">
        {labels.status(page, pageCount)}
      </span>
      <button type="button" className="button button-secondary button-small" disabled={page >= pageCount} onClick={() => onPage(page + 1)}>
        {labels.next}
      </button>
    </nav>
  );
}

/** Page number that falls back to 1 whenever `key` (the filters in force) changes. */
export function pageFor(state: { key: string; page: number }, key: string, pageCount: number) {
  const page = state.key === key ? state.page : 1;
  return Math.min(Math.max(page, 1), Math.max(pageCount, 1));
}
