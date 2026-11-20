"use client";

import { useId, useMemo, useState, type KeyboardEvent } from "react";
import { suggestionsFor, type Suggestion } from "@/lib/search";

const KIND_ICON: Record<Suggestion["kind"], string> = { category: "📂", brand: "🏷️", supplier: "🚚", product: "🔎" };

/**
 * A search box that drops down matching catalogue groups, brands and products as you type.
 * Picking one applies it straight away (for example the "Solar panels" group for "solar").
 */
export function SearchSuggest({
  id,
  value,
  onChange,
  suggestions,
  onPick,
  placeholder,
  label,
  kindLabels,
  className,
  autoFocus
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  /** Everything that can be suggested; filtered here by what is typed. */
  suggestions: Suggestion[];
  onPick: (s: Suggestion) => void;
  placeholder?: string;
  label: string;
  /** Words shown after each suggestion, e.g. { category: "Group", product: "Product" }. */
  kindLabels: Record<Suggestion["kind"], string>;
  className?: string;
  autoFocus?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const shown = useMemo(() => suggestionsFor(value, suggestions), [value, suggestions]);
  const visible = open && shown.length > 0;

  function pick(s: Suggestion) {
    onPick(s);
    setOpen(false);
    setActive(0);
  }

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") return setOpen(false);
    if (!shown.length) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setActive((a) => Math.min(a + 1, shown.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === "Enter" && visible) { e.preventDefault(); pick(shown[active]); }
  }

  return (
    <div className="combo search-suggest">
      <label className="visually-hidden" htmlFor={id}>{label}</label>
      <input
        id={id}
        className={className}
        type="search"
        role="combobox"
        aria-expanded={visible}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={visible ? `${listId}-${active}` : undefined}
        autoComplete="off"
        autoFocus={autoFocus}
        placeholder={placeholder}
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true); setActive(0); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={onKey}
      />
      {visible ? (
        <ul className="combo-list" id={listId} role="listbox" aria-label={label}>
          {shown.map((s, i) => (
            <li
              key={`${s.kind}:${s.value}`}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              className={i === active ? "combo-active" : ""}
              onMouseDown={(e) => { e.preventDefault(); pick(s); }}
              onMouseEnter={() => setActive(i)}
            >
              <strong><span aria-hidden="true">{KIND_ICON[s.kind]}</span> {s.label}</strong>
              <span>{kindLabels[s.kind]}{s.count > 1 ? ` · ${s.count}` : ""}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
