"use client";

import { useId, useMemo, useState, type KeyboardEvent } from "react";

export type PickerProduct = {
  id: string;
  name: string;
  brand?: string | null;
  model?: string | null;
  sku?: string | null;
  listMinor: number | null;
};

const MAX_SHOWN = 40;

/** Every typed word must appear somewhere in the product's name, brand, model or SKU. */
function matches(p: PickerProduct, words: string[]) {
  const text = [p.name, p.brand, p.model, p.sku].filter(Boolean).join(" ").toLowerCase();
  return words.every((w) => text.includes(w));
}

/** Brand, model and SKU on one line, so products with the same name can be told apart. */
export function productDetail(p: PickerProduct) {
  return [p.brand, p.model && p.model !== p.name ? p.model : null, p.sku ? `SKU ${p.sku}` : null].filter(Boolean).join(" · ");
}

/**
 * The item box on an invoice line. Typing shows a solid list of matching catalogue products
 * (name, then brand, model and SKU, with the price); picking one fills the line. Anything
 * typed that is not picked from the list is kept as a free-text item.
 */
export function ItemPicker({
  id,
  label,
  value,
  productId,
  products,
  formatPrice,
  onType,
  onPick
}: {
  id: string;
  label: string;
  value: string;
  productId?: string;
  products: PickerProduct[];
  formatPrice: (minor: number) => string;
  onType: (text: string) => void;
  onPick: (product: PickerProduct) => void;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const chosen = productId ? products.find((p) => p.id === productId) : undefined;

  const shown = useMemo(() => {
    const words = value.toLowerCase().split(/\s+/).filter(Boolean);
    // Once a product is chosen, opening the list again shows everything, not just that one.
    const filtered = chosen && chosen.name === value ? products : products.filter((p) => matches(p, words));
    return filtered.slice(0, MAX_SHOWN);
  }, [value, products, chosen]);
  const visible = open && shown.length > 0;

  function pick(p: PickerProduct) {
    onPick(p);
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
    <div className="combo item-picker">
      <input
        id={id}
        aria-label={label}
        role="combobox"
        aria-expanded={visible}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={visible ? `${listId}-${active}` : undefined}
        autoComplete="off"
        placeholder="Search products or type an item"
        maxLength={200}
        value={value}
        onChange={(e) => { onType(e.target.value); setOpen(true); setActive(0); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={onKey}
      />
      {chosen ? (
        <p className="item-picker-chosen">✓ {productDetail(chosen) || "From the catalogue"}</p>
      ) : value.trim() ? (
        <p className="item-picker-free">Typed item (not from the catalogue)</p>
      ) : null}
      {visible ? (
        <ul className="combo-list item-picker-list" id={listId} role="listbox" aria-label={label}>
          {shown.map((p, i) => (
            <li
              key={p.id}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              className={[i === active ? "combo-active" : "", p.id === productId ? "item-picker-on" : ""].filter(Boolean).join(" ")}
              onMouseDown={(e) => { e.preventDefault(); pick(p); }}
              onMouseEnter={() => setActive(i)}
            >
              <span className="item-picker-row">
                <strong>{p.name}</strong>
                <span className="item-picker-price">{p.listMinor !== null ? formatPrice(p.listMinor) : "No price"}</span>
              </span>
              {productDetail(p) ? <span>{productDetail(p)}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
