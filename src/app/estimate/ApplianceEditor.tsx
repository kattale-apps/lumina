"use client";

import { useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import {
  APPLIANCE_GUIDE,
  dailyKwh,
  guideByKey,
  searchGuide,
  type GuideAppliance
} from "../../../convex/lib/applianceGuide";

/** One appliance the customer has added. Numbers stay as text while they type. */
export type ApplianceRow = {
  id: string;
  guideKey?: string;
  name: string;
  size?: string;
  powerW: string;
  quantity: string;
  hours: string;
};

/** The company's own appliance list, used when an item is not in the guide. */
export type LibraryItem = { name: string; category: string; powerW: number; defaultHours: number };

type Suggestion =
  | { kind: "guide"; item: GuideAppliance }
  | { kind: "library"; item: LibraryItem }
  | { kind: "custom"; name: string };

let counter = 0;
const newId = () => `a${Date.now().toString(36)}${(counter++).toString(36)}`;

function fromGuide(g: GuideAppliance): ApplianceRow {
  const size = g.sizes[g.defaultSize];
  return {
    id: newId(),
    guideKey: g.key,
    name: g.name,
    size: size.label,
    powerW: String(size.powerW),
    quantity: String(g.defaultQuantity ?? 1),
    hours: String(g.defaultHours)
  };
}

/** Turns rows into what the server expects. Invalid numbers are sent as-is so the server explains them. */
export function rowsToItems(rows: ApplianceRow[]) {
  return rows.map((r) => ({
    name: r.name.trim(),
    guideKey: r.guideKey,
    size: r.size,
    powerW: r.powerW.trim() === "" ? undefined : Number(r.powerW),
    quantity: Number(r.quantity),
    hoursPerDay: Number(r.hours)
  }));
}

function fmtKwh(n: number) {
  if (!Number.isFinite(n) || n <= 0) return "0 kWh";
  return n < 1 ? `${Math.round(n * 1000)} Wh` : `${n.toFixed(n < 10 ? 2 : 1)} kWh`;
}

function Stepper({
  id,
  label,
  value,
  onChange,
  step,
  min,
  max,
  unit,
  decimals
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  step: number;
  min: number;
  max: number;
  unit?: string;
  decimals?: boolean;
}) {
  const n = Number(value);
  const bump = (d: number) => {
    const base = Number.isFinite(n) ? n : min;
    const next = Math.min(max, Math.max(min, Math.round((base + d) * 100) / 100));
    onChange(String(next));
  };
  return (
    <div className="stepper-field">
      <label htmlFor={id}>{label}</label>
      <div className="stepper">
        <button type="button" aria-label={`Less ${label.toLowerCase()}`} onClick={() => bump(-step)} disabled={Number.isFinite(n) && n <= min}>−</button>
        <input
          id={id}
          type="number"
          inputMode={decimals ? "decimal" : "numeric"}
          min={min}
          max={max}
          step="any"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={(e) => e.target.select()}
        />
        {unit ? <span className="stepper-unit">{unit}</span> : null}
        <button type="button" aria-label={`More ${label.toLowerCase()}`} onClick={() => bump(step)} disabled={Number.isFinite(n) && n >= max}>+</button>
      </div>
    </div>
  );
}

function RowCard({
  row,
  onChange,
  onRemove
}: {
  row: ApplianceRow;
  onChange: (patch: Partial<ApplianceRow>) => void;
  onRemove: () => void;
}) {
  const uid = useId();
  const guide = guideByKey(row.guideKey);
  const size = guide?.sizes.find((s) => s.label === row.size);
  const typical = size?.powerW;
  const powerN = Number(row.powerW);
  const kwh = dailyKwh(powerN, Number(row.quantity), Number(row.hours), guide?.duty);
  const custom = !guide;

  return (
    <li className="appliance-card" id={`card-${row.id}`}>
      <div className="appliance-card-head">
        {custom ? (
          <input
            className="appliance-name-input"
            aria-label="Appliance name"
            maxLength={60}
            value={row.name}
            onChange={(e) => onChange({ name: e.target.value })}
          />
        ) : (
          <h3>{row.name}</h3>
        )}
        <span className="appliance-kwh" aria-live="polite">{fmtKwh(kwh)} a day</span>
        <button type="button" className="appliance-remove" aria-label={`Remove ${row.name || "appliance"}`} onClick={onRemove}>×</button>
      </div>

      {guide && guide.sizes.length > 1 ? (
        <div className="appliance-size">
          <span className="field-label" id={`${uid}-size`}>{guide.sizeLabel ?? "Size"}</span>
          <div className="size-row" role="radiogroup" aria-labelledby={`${uid}-size`}>
            {guide.sizes.map((s) => (
              <button
                type="button"
                key={s.label}
                role="radio"
                aria-checked={row.size === s.label}
                className={`chip ${row.size === s.label ? "chip-on" : ""}`}
                // A new size brings that size's typical power; the customer can still change it.
                onClick={() => onChange({ size: s.label, powerW: String(s.powerW) })}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="appliance-fields">
        <Stepper id={`${uid}-w`} label="Power" unit="W" value={row.powerW} onChange={(v) => onChange({ powerW: v })} step={powerN >= 500 ? 100 : powerN >= 100 ? 10 : 1} min={1} max={50000} />
        <Stepper id={`${uid}-q`} label="How many" value={row.quantity} onChange={(v) => onChange({ quantity: v })} step={1} min={1} max={100} />
        <Stepper id={`${uid}-h`} label="Hours a day" value={row.hours} onChange={(v) => onChange({ hours: v })} step={Number(row.hours) <= 1 ? 0.25 : 1} min={0.25} max={24} decimals />
      </div>

      <p className="hint">
        {typical !== undefined && powerN !== typical ? (
          <>
            Typical for this size is {typical} W.{" "}
            <button type="button" className="link-button" onClick={() => onChange({ powerW: String(typical) })}>Use {typical} W</button>{" "}
          </>
        ) : custom ? (
          <>Enter the watts (W) printed on the label or charger. </>
        ) : (
          <>{typical ?? row.powerW} W is typical. If the label shows a different number, type it in. </>
        )}
        {guide?.dutyNote ?? ""}
      </p>
    </li>
  );
}

export function ApplianceEditor({
  rows,
  setRows,
  library
}: {
  rows: ApplianceRow[];
  setRows: (update: (prev: ApplianceRow[]) => ApplianceRow[]) => void;
  library: LibraryItem[];
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const suggestions = useMemo<Suggestion[]>(() => {
    const term = query.trim();
    if (!term) return [];
    const fromGuide: Suggestion[] = searchGuide(term, 6).map((item) => ({ kind: "guide", item }));
    const guideNames = new Set(APPLIANCE_GUIDE.map((g) => g.name.toLowerCase()));
    const lower = term.toLowerCase();
    // Company-specific items the guide does not cover.
    const fromLibrary: Suggestion[] = library
      .filter((l) => l.name.toLowerCase().includes(lower) && !guideNames.has(l.name.toLowerCase()))
      .slice(0, 3)
      .map((item) => ({ kind: "library", item }));
    const exact = [...fromGuide, ...fromLibrary].some((s) =>
      s.kind !== "custom" && s.item.name.toLowerCase() === lower
    );
    return [...fromGuide, ...fromLibrary, ...(exact ? [] : [{ kind: "custom" as const, name: term }])];
  }, [query, library]);

  function add(s: Suggestion) {
    let row: ApplianceRow;
    if (s.kind === "guide") row = fromGuide(s.item);
    else if (s.kind === "library") {
      row = { id: newId(), name: s.item.name, powerW: String(s.item.powerW), quantity: "1", hours: String(s.item.defaultHours) };
    } else {
      row = { id: newId(), name: s.name.slice(0, 60), powerW: "", quantity: "1", hours: "4" };
    }
    setRows((prev) => [...prev, row]);
    setQuery("");
    setOpen(false);
    setActive(0);
    // Bring the new card into view so the customer sees what to adjust.
    setTimeout(() => document.getElementById(`card-${row.id}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 50);
  }

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (!suggestions.length) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setActive((a) => Math.min(a + 1, suggestions.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); add(suggestions[active]); }
    else if (e.key === "Escape") setOpen(false);
  }

  const popular = APPLIANCE_GUIDE.filter((g) => g.popular);
  const total = rows.reduce((sum, r) => {
    const g = guideByKey(r.guideKey);
    const k = dailyKwh(Number(r.powerW), Number(r.quantity), Number(r.hours), g?.duty);
    return sum + (Number.isFinite(k) ? k : 0);
  }, 0);

  return (
    <div className="appliance-editor">
      <label htmlFor="es-search">Add an appliance</label>
      <div className="combo">
        <input
          id="es-search"
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={open && suggestions.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && suggestions.length ? `${listId}-${active}` : undefined}
          autoComplete="off"
          placeholder="Type e.g. fridge, TV, pump…"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); setActive(0); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={onKey}
        />
        {open && suggestions.length > 0 ? (
          <ul className="combo-list" id={listId} role="listbox">
            {suggestions.map((s, i) => (
              <li
                key={s.kind === "custom" ? "custom" : `${s.kind}-${s.item.name}`}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                className={i === active ? "combo-active" : ""}
                onMouseDown={(e) => { e.preventDefault(); add(s); }}
                onMouseEnter={() => setActive(i)}
              >
                {s.kind === "guide" ? (
                  <>
                    <strong>{s.item.name}</strong>
                    <span>
                      {s.item.sizes.length > 1
                        ? `${s.item.sizes[0].powerW}–${s.item.sizes[s.item.sizes.length - 1].powerW} W · choose size next`
                        : `about ${s.item.sizes[0].powerW} W`}
                    </span>
                  </>
                ) : s.kind === "library" ? (
                  <>
                    <strong>{s.item.name}</strong>
                    <span>about {s.item.powerW} W</span>
                  </>
                ) : (
                  <>
                    <strong>Add “{s.name}”</strong>
                    <span>Not on our list — you enter the watts</span>
                  </>
                )}
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className="quick-row" aria-label="Common appliances">
        {popular.map((g) => (
          <button type="button" key={g.key} className="chip" onClick={() => add({ kind: "guide", item: g })}>
            + {g.name}
          </button>
        ))}
      </div>

      {rows.length === 0 ? (
        <p className="hint">
          Tap a common appliance or type one above. We fill in typical sizes, watts and hours — change anything that
          doesn&apos;t match yours.
        </p>
      ) : (
        <>
          <ul className="appliance-list">
            {rows.map((r) => (
                <RowCard
                  key={r.id}
                  row={r}
                  onChange={(patch) => setRows((prev) => prev.map((x) => (x.id === r.id ? { ...x, ...patch } : x)))}
                  onRemove={() => setRows((prev) => prev.filter((x) => x.id !== r.id))}
                />
            ))}
          </ul>
          <p className="appliance-total" aria-live="polite">
            {rows.length} appliance{rows.length === 1 ? "" : "s"} · about <strong>{fmtKwh(total)}</strong> a day
          </p>
        </>
      )}
    </div>
  );
}
