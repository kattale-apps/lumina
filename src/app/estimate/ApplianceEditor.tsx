"use client";

import { useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import {
  APPLIANCE_GUIDE,
  dailyKwh,
  emojiFor,
  guideByKey,
  searchGuide,
  type GuideAppliance
} from "../../../convex/lib/applianceGuide";
import { Rich, useT, type MessageKey } from "@/lib/i18n";
import { en } from "@/lib/i18n/en";

/** Translation keys for guide text; anything not in the list shows as it is. */
const known = (key: string): key is MessageKey => key in en;
export const categoryKey = (category: string) =>
  `category.${category.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "")}`;
function useGuideText() {
  const t = useT();
  return {
    t,
    name: (g: { key: string; name: string }) => (known(`appliance.${g.key}`) ? t(`appliance.${g.key}` as MessageKey) : g.name),
    category: (c: string) => (known(categoryKey(c)) ? t(categoryKey(c) as MessageKey) : c),
    sizeLabel: (g: GuideAppliance) => {
      const k = `appliance.${g.key}.sizeLabel`;
      return known(k) ? t(k as MessageKey) : g.sizeLabel ?? t("appliances.size");
    },
    dutyNote: (g: GuideAppliance) => {
      const k = `appliance.${g.key}.dutyNote`;
      return known(k) ? t(k as MessageKey) : g.dutyNote ?? "";
    }
  };
}

/** One appliance the customer has added. Numbers stay as text while they type. */
export type ApplianceRow = {
  id: string;
  emoji: string;
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
    emoji: g.emoji,
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
  const t = useT();
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
        <button type="button" aria-label={t("appliances.less", { label })} onClick={() => bump(-step)} disabled={Number.isFinite(n) && n <= min}>−</button>
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
        <button type="button" aria-label={t("appliances.more", { label })} onClick={() => bump(step)} disabled={Number.isFinite(n) && n >= max}>+</button>
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
  const text = useGuideText();
  const t = text.t;
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
            aria-label={t("appliances.name")}
            maxLength={60}
            value={row.name}
            onChange={(e) => onChange({ name: e.target.value })}
          />
        ) : (
          <h3><span aria-hidden="true">{row.emoji}</span> {guide ? text.name(guide) : row.name}</h3>
        )}
        <span className="appliance-kwh" aria-live="polite">{t("appliances.perDay", { kwh: fmtKwh(kwh) })}</span>
        <button type="button" className="appliance-remove" aria-label={t("appliances.remove", { name: (guide ? text.name(guide) : row.name) || t("appliances.removeGeneric") })} onClick={onRemove}>×</button>
      </div>

      {guide && guide.sizes.length > 1 ? (
        <div className="appliance-size">
          <span className="field-label" id={`${uid}-size`}>{text.sizeLabel(guide)}</span>
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
        <Stepper id={`${uid}-w`} label={t("appliances.power")} unit="W" value={row.powerW} onChange={(v) => onChange({ powerW: v })} step={powerN >= 500 ? 100 : powerN >= 100 ? 10 : 1} min={1} max={50000} />
        <Stepper id={`${uid}-q`} label={t("appliances.howMany")} value={row.quantity} onChange={(v) => onChange({ quantity: v })} step={1} min={1} max={100} />
        <Stepper id={`${uid}-h`} label={t("appliances.hours")} value={row.hours} onChange={(v) => onChange({ hours: v })} step={Number(row.hours) <= 1 ? 0.25 : 1} min={0.25} max={24} decimals />
      </div>

      <p className="hint">
        {typical !== undefined && powerN !== typical ? (
          <>
            {t("appliances.typicalForSize", { watts: typical })}{" "}
            <button type="button" className="link-button" onClick={() => onChange({ powerW: String(typical) })}>{t("appliances.useTypical", { watts: typical })}</button>{" "}
          </>
        ) : custom ? (
          <>{t("appliances.customWatts")} </>
        ) : (
          <>{t("appliances.typical", { watts: typical ?? row.powerW })} </>
        )}
        {guide ? text.dutyNote(guide) : ""}
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
  const text = useGuideText();
  const t = text.t;
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState("popular");
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
      row = { id: newId(), emoji: emojiFor(s.item.category), name: s.item.name, powerW: String(s.item.powerW), quantity: "1", hours: String(s.item.defaultHours) };
    } else {
      row = { id: newId(), emoji: "🔌", name: s.name.slice(0, 60), powerW: "", quantity: "1", hours: "4" };
    }
    setRows((prev) => [...prev, row]);
    setQuery("");
    setOpen(false);
    setActive(0);
    // From search, bring the new card into view; from the picker, stay put so several can be tapped in a row.
    if (s.kind !== "guide" || query.trim()) {
      setTimeout(() => document.getElementById(`card-${row.id}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 50);
    }
  }

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (!suggestions.length) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setActive((a) => Math.min(a + 1, suggestions.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); add(suggestions[active]); }
    else if (e.key === "Escape") setOpen(false);
  }

  const tabs = useMemo(() => {
    const cats: string[] = [];
    for (const g of APPLIANCE_GUIDE) if (!cats.includes(g.category)) cats.push(g.category);
    return [{ key: "popular", label: t("appliances.popular"), emoji: "⭐" }, ...cats.map((c) => ({ key: c, label: text.category(c), emoji: emojiFor(c) }))];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t]);
  const tabItems = tab === "popular" ? APPLIANCE_GUIDE.filter((g) => g.popular) : APPLIANCE_GUIDE.filter((g) => g.category === tab);
  const total = rows.reduce((sum, r) => {
    const g = guideByKey(r.guideKey);
    const k = dailyKwh(Number(r.powerW), Number(r.quantity), Number(r.hours), g?.duty);
    return sum + (Number.isFinite(k) ? k : 0);
  }, 0);

  return (
    <div className="appliance-editor">
      <div className="picker">
        <div className="picker-tabs" role="tablist" aria-label={t("appliances.groups")}>
          {tabs.map((g) => (
            <button
              type="button"
              role="tab"
              key={g.key}
              aria-selected={tab === g.key}
              className={tab === g.key ? "picker-tab picker-tab-on" : "picker-tab"}
              onClick={() => setTab(g.key)}
            >
              <span aria-hidden="true">{g.emoji}</span> {g.label}
            </button>
          ))}
        </div>
        <div className="picker-grid" role="tabpanel" aria-label={tabs.find((g) => g.key === tab)?.label}>
          {tabItems.map((g) => {
            const count = rows.filter((r) => r.guideKey === g.key).length;
            return (
              <button
                type="button"
                key={g.key}
                className={count ? "pick pick-on" : "pick"}
                onClick={() => add({ kind: "guide", item: g })}
                aria-label={count ? t("appliances.addAnother", { name: text.name(g), count }) : t("appliances.add", { name: text.name(g) })}
              >
                <span className="pick-emoji" aria-hidden="true">{g.emoji}</span>
                <span className="pick-name">{text.name(g)}</span>
                {count ? <span className="pick-count">{count}</span> : <span className="pick-plus" aria-hidden="true">+</span>}
              </button>
            );
          })}
        </div>
      </div>

      <label htmlFor="es-search">{t("appliances.searchLabel")}</label>
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
          placeholder={t("appliances.searchPlaceholder")}
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
                    <strong><span aria-hidden="true">{s.item.emoji}</span> {text.name(s.item)}</strong>
                    <span>
                      {s.item.sizes.length > 1
                        ? t("appliances.rangeChooseSize", { min: s.item.sizes[0].powerW, max: s.item.sizes[s.item.sizes.length - 1].powerW })
                        : t("appliances.about", { watts: s.item.sizes[0].powerW })}
                    </span>
                  </>
                ) : s.kind === "library" ? (
                  <>
                    <strong><span aria-hidden="true">{emojiFor(s.item.category)}</span> {s.item.name}</strong>
                    <span>{t("appliances.about", { watts: s.item.powerW })}</span>
                  </>
                ) : (
                  <>
                    <strong><span aria-hidden="true">🔌</span> {t("appliances.addCustom", { name: s.name })}</strong>
                    <span>{t("appliances.customHint")}</span>
                  </>
                )}
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {rows.length === 0 ? (
        <p className="hint">{t("appliances.empty")}</p>
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
            <Rich text={rows.length === 1 ? t("appliances.totalOne", { kwh: fmtKwh(total) }) : t("appliances.total", { count: rows.length, kwh: fmtKwh(total) })} />
          </p>
        </>
      )}
    </div>
  );
}
