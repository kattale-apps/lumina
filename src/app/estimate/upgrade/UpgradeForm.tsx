"use client";

import type { Dispatch, SetStateAction } from "react";
import { type ExistingSystem, type Goal, type UpgradeNeeds } from "./describe";
import { translateEnglish, useT, type Translate } from "@/lib/i18n";

type SystemType = ExistingSystem["systemType"];
type Chemistry = "lithium" | "lead_acid" | "unknown";

/** Everything is kept as typed text so half-finished numbers are never lost. */
export type UpgradeFormState = {
  systemType: SystemType;
  systemVoltage: string;
  hasInverter: boolean;
  inverterW: string;
  inverterSurgeW: string;
  inverterHasSolar: boolean;
  inverterPvPowerW: string;
  inverterPvVoltage: string;
  inverterMpptMin: string;
  inverterPvCurrentA: string;
  inverterChargeA: string;
  hasController: boolean;
  controllerTech: "MPPT" | "PWM";
  controllerA: string;
  controllerPvVoltage: string;
  controllerPvPowerW: string;
  hasPanels: boolean;
  panelCount: string;
  panelWp: string;
  panelPerString: string;
  panelVoc: string;
  panelVmp: string;
  panelIsc: string;
  hasBatteries: boolean;
  batteryCount: string;
  batteryV: string;
  batteryAh: string;
  batteryChemistry: Chemistry;
  batteryAge: string;
  goals: Goal[];
  backupHours: string;
  backupLoadW: string;
  dailyKwh: string;
  peakLoadW: string;
  faultyParts: FaultyPart[];
  faultNote: string;
};

type FaultyPart = NonNullable<UpgradeNeeds["faultyParts"]>[number];

export function blankUpgradeForm(): UpgradeFormState {
  return {
    systemType: "hybrid",
    systemVoltage: "",
    hasInverter: true,
    inverterW: "",
    inverterSurgeW: "",
    inverterHasSolar: true,
    inverterPvPowerW: "",
    inverterPvVoltage: "",
    inverterMpptMin: "",
    inverterPvCurrentA: "",
    inverterChargeA: "",
    hasController: false,
    controllerTech: "MPPT",
    controllerA: "",
    controllerPvVoltage: "",
    controllerPvPowerW: "",
    hasPanels: true,
    panelCount: "",
    panelWp: "",
    panelPerString: "",
    panelVoc: "",
    panelVmp: "",
    panelIsc: "",
    hasBatteries: true,
    batteryCount: "",
    batteryV: "",
    batteryAh: "",
    batteryChemistry: "unknown",
    batteryAge: "",
    goals: [],
    backupHours: "",
    backupLoadW: "",
    dailyKwh: "",
    peakLoadW: "",
    faultyParts: [],
    faultNote: ""
  };
}

class FormProblem extends Error {}

/** A required number. Commas and spaces are accepted, e.g. "3,000". */
let formT: Translate = translateEnglish;
function need(raw: string, label: string) {
  const n = Number(raw.replace(/[,\s]/g, ""));
  if (!raw.trim() || !Number.isFinite(n) || n <= 0) throw new FormProblem(formT("upgradeForm.err.number", { label }));
  return n;
}
/** An optional number: empty means "not known", which the check treats as needing a technician. */
function maybe(raw: string, label: string, allowZero = false) {
  if (!raw.trim()) return undefined;
  const n = Number(raw.replace(/[,\s]/g, ""));
  if (!Number.isFinite(n) || n < 0 || (!allowZero && n === 0)) throw new FormProblem(formT("upgradeForm.err.maybe", { label }));
  return n;
}

/** Turns the form into what the server expects, or says what is still missing. */
export function toPayload(
  f: UpgradeFormState,
  t: Translate = translateEnglish
): { ok: true; system: ExistingSystem; needs: UpgradeNeeds } | { ok: false; error: string } {
  formT = t;
  try {
    const batteryless = f.systemType === "grid_tied" && !f.hasBatteries && !f.hasController;
    const system: ExistingSystem = { systemType: f.systemType };
    if (!batteryless) system.systemVoltage = need(f.systemVoltage, t("upgradeForm.field.systemVoltage"));

    if (f.hasInverter) {
      system.inverter = {
        ratedW: need(f.inverterW, t("upgradeForm.field.inverterPower")),
        surgeW: maybe(f.inverterSurgeW, t("upgradeForm.field.inverterSurge")),
        hasSolarInput: f.inverterHasSolar,
        maxPvPowerW: f.inverterHasSolar ? maybe(f.inverterPvPowerW, t("upgradeForm.field.inverterPvPower")) : undefined,
        maxPvVoltage: f.inverterHasSolar ? maybe(f.inverterPvVoltage, t("upgradeForm.field.inverterPvVoltage")) : undefined,
        mpptMinVoltage: f.inverterHasSolar ? maybe(f.inverterMpptMin, t("upgradeForm.field.inverterMppt")) : undefined,
        maxPvCurrentA: f.inverterHasSolar ? maybe(f.inverterPvCurrentA, t("upgradeForm.field.inverterPvCurrent")) : undefined,
        maxChargeA: maybe(f.inverterChargeA, t("upgradeForm.field.inverterCharge"))
      };
    }
    if (f.hasController) {
      system.controller = {
        technology: f.controllerTech,
        maxChargeA: need(f.controllerA, t("upgradeForm.field.controllerCurrent")),
        maxPvVoltage: maybe(f.controllerPvVoltage, t("upgradeForm.field.controllerPvVoltage")),
        maxPvPowerW: maybe(f.controllerPvPowerW, t("upgradeForm.field.controllerPvPower"))
      };
    }
    if (f.hasPanels) {
      system.panels = {
        count: need(f.panelCount, t("upgradeForm.field.panelCount")),
        wp: need(f.panelWp, t("upgradeForm.field.panelPower")),
        perString: maybe(f.panelPerString, t("upgradeForm.field.panelsPerString")),
        voc: maybe(f.panelVoc, t("upgradeForm.field.panelVoc")),
        vmp: maybe(f.panelVmp, t("upgradeForm.field.panelVmp")),
        isc: maybe(f.panelIsc, t("upgradeForm.field.panelIsc"))
      };
    }
    if (f.hasBatteries) {
      system.batteries = {
        count: need(f.batteryCount, t("upgradeForm.field.batteryCount")),
        nominalV: need(f.batteryV, t("upgradeForm.field.batteryVoltage")),
        ah: need(f.batteryAh, t("upgradeForm.field.batteryCapacity")),
        chemistry: f.batteryChemistry,
        ageYears: maybe(f.batteryAge, t("upgradeForm.field.batteryAge"), true)
      };
    }
    if (!system.inverter && !system.controller && !system.panels && !system.batteries) {
      throw new FormProblem(t("upgradeForm.err.nothing"));
    }

    if (f.goals.length === 0) throw new FormProblem(t("upgradeForm.err.goal"));
    const needs: UpgradeNeeds = { goals: f.goals };
    if (f.goals.includes("battery")) {
      const hours = maybe(f.backupHours, t("upgradeForm.field.backupHours"));
      const load = maybe(f.backupLoadW, t("upgradeForm.field.backupLoad"));
      if ((hours === undefined) !== (load === undefined)) {
        throw new FormProblem(t("upgradeForm.err.backupPair"));
      }
      needs.backupHours = hours;
      needs.backupLoadW = load;
    }
    if (f.goals.includes("panels")) needs.dailyKwh = maybe(f.dailyKwh, t("upgradeForm.field.dailyKwh"));
    if (f.goals.includes("inverter")) needs.peakLoadW = maybe(f.peakLoadW, t("upgradeForm.field.peakLoad"));
    if (f.goals.includes("repair")) {
      // Only parts that are part of the system can be faulty.
      const present: Record<FaultyPart, boolean> = {
        inverter: f.hasInverter,
        battery: f.hasBatteries,
        panels: f.hasPanels,
        controller: f.hasController
      };
      const parts = f.faultyParts.filter((p) => present[p]);
      if (parts.length === 0) throw new FormProblem(t("upgradeForm.err.faultPart"));
      needs.faultyParts = parts;
      const note = f.faultNote.trim();
      if (note.length > 500) throw new FormProblem(t("upgradeForm.err.faultLength"));
      if (note) needs.faultNote = note;
    }
    return { ok: true, system: clean(system), needs: clean(needs) };
  } catch (e) {
    if (e instanceof FormProblem) return { ok: false, error: e.message };
    throw e;
  }
}

/** What is still missing on one question (1 to 4), or null when it can be left. */
export function stepProblem(f: UpgradeFormState, step: number, t: Translate = translateEnglish): string | null {
  formT = t;
  try {
    if (step === 1) {
      const batteryless = f.systemType === "grid_tied" && !f.hasBatteries && !f.hasController;
      if (!batteryless) need(f.systemVoltage, t("upgradeForm.field.systemVoltage"));
    } else if (step === 2) {
      if (f.hasInverter) need(f.inverterW, t("upgradeForm.field.inverterPower"));
      if (f.hasController) need(f.controllerA, t("upgradeForm.field.controllerCurrent"));
    } else if (step === 3) {
      if (f.hasPanels) {
        need(f.panelCount, t("upgradeForm.field.panelCount"));
        need(f.panelWp, t("upgradeForm.field.panelPower"));
      }
      if (f.hasBatteries) {
        need(f.batteryCount, t("upgradeForm.field.batteryCount"));
        need(f.batteryV, t("upgradeForm.field.batteryVoltage"));
        need(f.batteryAh, t("upgradeForm.field.batteryCapacity"));
      }
    } else if (step === 4 && f.goals.length === 0) {
      throw new FormProblem(t("upgradeForm.err.goal"));
    }
    return null;
  } catch (e) {
    if (e instanceof FormProblem) return e.message;
    throw e;
  }
}

/** The first box that still needs an answer on a question, so it can be made to glow. */
function nextToFill(f: UpgradeFormState, step: number): string {
  if (step === 1) return f.systemVoltage.trim() || (f.systemType === "grid_tied" && !f.hasBatteries && !f.hasController) ? "" : "up-voltage";
  if (step === 2) {
    if (f.hasInverter && !f.inverterW.trim()) return "up-inv-w";
    if (f.hasController && !f.controllerA.trim()) return "up-ctl-a";
    return "";
  }
  if (step === 3) {
    if (f.hasPanels && !f.panelCount.trim()) return "up-pv-n";
    if (f.hasPanels && !f.panelWp.trim()) return "up-pv-w";
    if (f.hasBatteries && !f.batteryCount.trim()) return "up-bat-n";
    if (f.hasBatteries && !f.batteryV.trim()) return "up-bat-v";
    if (f.hasBatteries && !f.batteryAh.trim()) return "up-bat-ah";
    return "";
  }
  return step === 4 && f.goals.length === 0 ? "goals" : "";
}

/** Drops unset fields so they are sent as absent, not as empty values. */
function clean<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

const FAULTY_PARTS: FaultyPart[] = ["inverter", "battery", "panels", "controller"];
const SYSTEM_TYPES: SystemType[] = ["hybrid", "off_grid", "backup_only", "grid_tied"];
const GOALS: Goal[] = ["battery", "panels", "inverter", "swaps", "repair"];

function Num({
  id, label, unit, value, onChange, hint, placeholder, required, glow
}: {
  /** Id of the box to draw the eye to; this one glows when it matches. */
  glow?: string;
  id: string;
  label: string;
  unit?: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
  placeholder?: string;
  required?: boolean;
}) {
  const t = useT();
  return (
    <div className="upgrade-field">
      <label htmlFor={id}>
        {label}
        {unit ? <span className="upgrade-unit"> ({unit})</span> : null}
        {required ? null : <span className="step-optional">{t("common.optional")}</span>}
      </label>
      <input id={id} className={glow === id ? "guide-glow" : undefined} inputMode="decimal" autoComplete="off" placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />
      {hint ? <p className="hint">{hint}</p> : null}
    </div>
  );
}

function Chips({ label, options, value, onChange }: { label: string; options: string[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="quick-row" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o} type="button" className={value === o ? "chip chip-on" : "chip"} aria-pressed={value === o} onClick={() => onChange(o)}>
          {o} V
        </button>
      ))}
    </div>
  );
}

/**
 * The questions about an existing solar system. Only the figures needed to
 * start are required; everything else may be left empty and is then flagged
 * for a technician instead of being assumed.
 */
export function UpgradeForm({
  state, setState, audience, step
}: {
  /** Show only this question (1 to 4) and guide the eye to its next empty box. All four when omitted. */
  step?: number;
  state: UpgradeFormState;
  setState: Dispatch<SetStateAction<UpgradeFormState>>;
  audience: "public" | "staff";
}) {
  const t = useT();
  const set = <K extends keyof UpgradeFormState>(key: K, value: UpgradeFormState[K]) => setState((s) => ({ ...s, [key]: value }));
  const you = audience === "public";
  const f = state;
  const needsVoltage = !(f.systemType === "grid_tied" && !f.hasBatteries && !f.hasController);
  const off = (n: number) => step !== undefined && step !== n;
  const glow = step === undefined ? "" : nextToFill(f, step);

  function chooseType(type: SystemType) {
    setState((s) => ({
      ...s,
      systemType: type,
      // Sensible starting switches for each kind of system; all can be changed.
      hasPanels: type === "backup_only" ? false : true,
      hasBatteries: type === "grid_tied" ? false : true,
      inverterHasSolar: type === "backup_only" ? false : s.inverterHasSolar
    }));
  }
  const toggleGoal = (goal: Goal) =>
    set("goals", f.goals.includes(goal) ? f.goals.filter((g) => g !== goal) : [...f.goals, goal]);

  return (
    <>
      <section className="step step-1" aria-labelledby="up-q1" hidden={off(1)}>
        <h2 id="up-q1"><span className="step-num">1</span> {t("upgradeForm.q1")}</h2>
        <div className="choice-row" role="radiogroup" aria-labelledby="up-q1">
          {SYSTEM_TYPES.map((type) => (
            <button type="button" key={type} role="radio" aria-checked={f.systemType === type} className={`choice ${f.systemType === type ? "choice-on" : ""}`} onClick={() => chooseType(type)}>
              <strong>{t(`upgradeForm.type.${type}`)}</strong>
              <span>{t(`upgradeForm.type.${type}.hint`)}</span>
            </button>
          ))}
        </div>
        {needsVoltage ? (
          <div className="upgrade-field">
            <label htmlFor="up-voltage">{t("upgradeForm.systemVoltage")} <span className="upgrade-unit">(V)</span></label>
            <Chips label={t("upgradeForm.commonSystemVoltages")} options={["12", "24", "48"]} value={f.systemVoltage} onChange={(v) => set("systemVoltage", v)} />
            <input id="up-voltage" className={glow === "up-voltage" ? "guide-glow" : undefined} inputMode="decimal" autoComplete="off" placeholder={t("upgradeForm.orType")} value={f.systemVoltage} onChange={(e) => set("systemVoltage", e.target.value)} />
            <p className="hint">{t("upgradeForm.voltageHint")}</p>
          </div>
        ) : null}
      </section>

      <section className="step step-2" aria-labelledby="up-q2" hidden={off(2)}>
        <h2 id="up-q2"><span className="step-num">2</span> {t("upgradeForm.q2")}</h2>
        <label className="check-row" htmlFor="up-has-inv">
          <input id="up-has-inv" type="checkbox" checked={f.hasInverter} onChange={(e) => set("hasInverter", e.target.checked)} />
          {t("upgradeForm.hasInverter")}
        </label>
        {f.hasInverter ? (
          <>
            <Num id="up-inv-w" glow={glow} required label={t("upgradeForm.power")} unit="W" value={f.inverterW} onChange={(v) => set("inverterW", v)} placeholder="e.g. 3000"
              hint={t("upgradeForm.inverterPowerHint")} />
            <label className="check-row" htmlFor="up-inv-solar">
              <input id="up-inv-solar" type="checkbox" checked={f.inverterHasSolar} onChange={(e) => set("inverterHasSolar", e.target.checked)} />
              {t("upgradeForm.inverterSolar")}
            </label>
            <details className="upgrade-more">
              <summary>{t("upgradeForm.moreInverter")}</summary>
              {f.inverterHasSolar ? (
                <div className="upgrade-grid">
                  <Num id="up-inv-pvw" label={t("upgradeForm.maxPvPower")} unit="W" value={f.inverterPvPowerW} onChange={(v) => set("inverterPvPowerW", v)} />
                  <Num id="up-inv-pvv" label={t("upgradeForm.maxPvVoltage")} unit="V" value={f.inverterPvVoltage} onChange={(v) => set("inverterPvVoltage", v)} />
                  <Num id="up-inv-mppt" label={t("upgradeForm.mpptMin")} unit="V" value={f.inverterMpptMin} onChange={(v) => set("inverterMpptMin", v)} />
                  <Num id="up-inv-pva" label={t("upgradeForm.maxPvCurrent")} unit="A" value={f.inverterPvCurrentA} onChange={(v) => set("inverterPvCurrentA", v)} />
                </div>
              ) : null}
              <div className="upgrade-grid">
                <Num id="up-inv-charge" label={t("upgradeForm.maxCharge")} unit="A" value={f.inverterChargeA} onChange={(v) => set("inverterChargeA", v)} />
                <Num id="up-inv-surge" label={t("upgradeForm.surge")} unit="W" value={f.inverterSurgeW} onChange={(v) => set("inverterSurgeW", v)} />
              </div>
              <p className="hint">{you ? t("upgradeForm.leaveEmptyYou") : t("upgradeForm.leaveEmptyCustomer")}</p>
            </details>
          </>
        ) : null}

        <label className="check-row" htmlFor="up-has-ctl">
          <input id="up-has-ctl" type="checkbox" checked={f.hasController} onChange={(e) => set("hasController", e.target.checked)} />
          {t("upgradeForm.hasController")}
        </label>
        {f.hasController ? (
          <>
            <div className="segmented" role="radiogroup" aria-label={t("upgradeForm.controllerType")}>
              {(["MPPT", "PWM"] as const).map((tech) => (
                <button key={tech} type="button" role="radio" aria-checked={f.controllerTech === tech} className={f.controllerTech === tech ? "segmented-on" : ""} onClick={() => set("controllerTech", tech)}>
                  {tech}
                </button>
              ))}
            </div>
            <div className="upgrade-grid">
              <Num id="up-ctl-a" glow={glow} required label={t("upgradeForm.ratedCurrent")} unit="A" value={f.controllerA} onChange={(v) => set("controllerA", v)} placeholder="e.g. 60" />
              <Num id="up-ctl-v" label={t("upgradeForm.maxSolarVoltage")} unit="V" value={f.controllerPvVoltage} onChange={(v) => set("controllerPvVoltage", v)} placeholder="e.g. 150" />
              <Num id="up-ctl-w" label={t("upgradeForm.maxSolarPower")} unit="W" value={f.controllerPvPowerW} onChange={(v) => set("controllerPvPowerW", v)} />
            </div>
          </>
        ) : null}
      </section>

      <section className="step step-3" aria-labelledby="up-q3" hidden={off(3)}>
        <h2 id="up-q3"><span className="step-num">3</span> {t("upgradeForm.q3")}</h2>
        <label className="check-row" htmlFor="up-has-pv">
          <input id="up-has-pv" type="checkbox" checked={f.hasPanels} onChange={(e) => set("hasPanels", e.target.checked)} />
          {t("upgradeForm.hasPanels")}
        </label>
        {f.hasPanels ? (
          <>
            <div className="upgrade-grid">
              <Num id="up-pv-n" glow={glow} required label={t("upgradeForm.panelCount")} value={f.panelCount} onChange={(v) => set("panelCount", v)} />
              <Num id="up-pv-w" glow={glow} required label={t("upgradeForm.panelEach")} unit="W" value={f.panelWp} onChange={(v) => set("panelWp", v)} placeholder="e.g. 330" />
              <Num id="up-pv-s" label={t("upgradeForm.perString")} value={f.panelPerString} onChange={(v) => set("panelPerString", v)}
                hint={t("upgradeForm.perStringHint")} />
            </div>
            <details className="upgrade-more">
              <summary>{t("upgradeForm.panelLabel")}</summary>
              <div className="upgrade-grid">
                <Num id="up-pv-voc" label={t("upgradeForm.voc")} unit="V" value={f.panelVoc} onChange={(v) => set("panelVoc", v)} />
                <Num id="up-pv-vmp" label={t("upgradeForm.vmp")} unit="V" value={f.panelVmp} onChange={(v) => set("panelVmp", v)} />
                <Num id="up-pv-isc" label={t("upgradeForm.isc")} unit="A" value={f.panelIsc} onChange={(v) => set("panelIsc", v)} />
              </div>
              <p className="hint">{t("upgradeForm.panelLabelHint")}</p>
            </details>
          </>
        ) : null}

        <label className="check-row" htmlFor="up-has-bat">
          <input id="up-has-bat" type="checkbox" checked={f.hasBatteries} onChange={(e) => set("hasBatteries", e.target.checked)} />
          {t("upgradeForm.hasBatteries")}
        </label>
        {f.hasBatteries ? (
          <>
            <div className="upgrade-grid">
              <Num id="up-bat-n" glow={glow} required label={t("upgradeForm.batteryCount")} value={f.batteryCount} onChange={(v) => set("batteryCount", v)} />
              <div className="upgrade-field">
                <label htmlFor="up-bat-v">{t("upgradeForm.batteryEachV")} <span className="upgrade-unit">(V)</span></label>
                <div className="upgrade-control">
                  <input id="up-bat-v" className={glow === "up-bat-v" ? "guide-glow" : undefined} inputMode="decimal" autoComplete="off" placeholder={t("upgradeForm.orType")} value={f.batteryV} onChange={(e) => set("batteryV", e.target.value)} />
                  <Chips label={t("upgradeForm.commonBatteryVoltages")} options={["12", "24", "48", "51.2"]} value={f.batteryV} onChange={(v) => set("batteryV", v)} />
                </div>
              </div>
              <Num id="up-bat-ah" glow={glow} required label={t("upgradeForm.capacityEach")} unit="Ah" value={f.batteryAh} onChange={(v) => set("batteryAh", v)} placeholder="e.g. 200" />
              <Num id="up-bat-age" label={t("upgradeForm.age")} unit={t("upgradeForm.years")} value={f.batteryAge} onChange={(v) => set("batteryAge", v)} />
            </div>
            <p className="field-label" id="up-chem">{t("upgradeForm.batteryType")}</p>
            <div className="choice-row" role="radiogroup" aria-labelledby="up-chem">
              {(["lithium", "lead_acid", "unknown"] as const).map((value) => (
                <button type="button" key={value} role="radio" aria-checked={f.batteryChemistry === value} className={`choice ${f.batteryChemistry === value ? "choice-on" : ""}`} onClick={() => set("batteryChemistry", value)}>
                  <strong>{t(`upgradeForm.chem.${value}`)}</strong>
                  <span>{t(`upgradeForm.chem.${value}.hint`)}</span>
                </button>
              ))}
            </div>
          </>
        ) : null}
      </section>

      <section className="step step-4" aria-labelledby="up-q4" hidden={off(4)}>
        <h2 id="up-q4"><span className="step-num">4</span> {you ? t("upgradeForm.q4You") : t("upgradeForm.q4Customer")}</h2>
        <div className={`choice-row${glow === "goals" ? " guide-glow" : ""}`} role="group" aria-labelledby="up-q4">
          {GOALS.map((g) => (
            <button type="button" key={g} aria-pressed={f.goals.includes(g)} className={`choice ${f.goals.includes(g) ? "choice-on" : ""}`} onClick={() => toggleGoal(g)}>
              <strong>{f.goals.includes(g) ? "✓ " : ""}{t(`upgradeForm.goal.${g}`)}</strong>
              <span>{t(`upgradeForm.goal.${g}.hint`)}</span>
            </button>
          ))}
        </div>
        {f.goals.includes("battery") ? (
          <div className="upgrade-grid">
            <Num id="up-need-h" label={t("upgradeForm.backupHours")} unit="h" value={f.backupHours} onChange={(v) => set("backupHours", v)} placeholder="e.g. 8" />
            <Num id="up-need-w" label={t("upgradeForm.backupLoad")} unit="W" value={f.backupLoadW} onChange={(v) => set("backupLoadW", v)} placeholder="e.g. 500"
              hint={t("upgradeForm.backupLoadHint")} />
          </div>
        ) : null}
        {f.goals.includes("panels") ? (
          <Num id="up-need-kwh" label={t("upgradeForm.dailyKwh")} unit="kWh" value={f.dailyKwh} onChange={(v) => set("dailyKwh", v)} placeholder="e.g. 8"
            hint={t("upgradeForm.dailyKwhHint")} />
        ) : null}
        {f.goals.includes("repair") ? (
          <div className="upgrade-fault">
            <p className="upgrade-fault-q">{you ? t("upgradeForm.faultQYou") : t("upgradeForm.faultQCustomer")} <span className="hint">{t("upgradeForm.tickAll")}</span></p>
            <div className="choice-row">
              {FAULTY_PARTS.map((part) => {
                const present = { inverter: f.hasInverter, battery: f.hasBatteries, panels: f.hasPanels, controller: f.hasController }[part];
                if (!present) return null;
                const on = f.faultyParts.includes(part);
                return (
                  <button
                    type="button"
                    key={part}
                    aria-pressed={on}
                    className={`choice ${on ? "choice-on" : ""}`}
                    onClick={() => set("faultyParts", on ? f.faultyParts.filter((p) => p !== part) : [...f.faultyParts, part])}
                  >
                    <strong>{on ? "✓ " : ""}{t(`upgradeForm.fault.${part}`)}</strong>
                    <span>{t(`upgradeForm.faultHint.${part}`)}</span>
                  </button>
                );
              })}
            </div>
            <label htmlFor="up-fault-note">{you ? t("upgradeForm.whatWrongYou") : t("upgradeForm.whatWrongCustomer")} <span className="step-optional">{t("common.optional")}</span></label>
            <textarea
              id="up-fault-note"
              rows={3}
              maxLength={500}
              placeholder={t("upgradeForm.faultPlaceholder")}
              value={f.faultNote}
              onChange={(e) => set("faultNote", e.target.value)}
            />
            <p className="hint">{t("upgradeForm.faultTestNote")}</p>
          </div>
        ) : null}
        {f.goals.includes("inverter") ? (
          <Num id="up-need-peak" label={t("upgradeForm.peak")} unit="W" value={f.peakLoadW} onChange={(v) => set("peakLoadW", v)} placeholder="e.g. 3500"
            hint={t("upgradeForm.peakHint")} />
        ) : null}
      </section>
    </>
  );
}
