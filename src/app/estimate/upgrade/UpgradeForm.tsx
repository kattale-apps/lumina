"use client";

import type { Dispatch, SetStateAction } from "react";
import type { ExistingSystem, Goal, UpgradeNeeds } from "./describe";

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
};

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
    peakLoadW: ""
  };
}

class FormProblem extends Error {}

/** A required number. Commas and spaces are accepted, e.g. "3,000". */
function need(raw: string, label: string) {
  const n = Number(raw.replace(/[,\s]/g, ""));
  if (!raw.trim() || !Number.isFinite(n) || n <= 0) throw new FormProblem(`${label}: enter a number above 0.`);
  return n;
}
/** An optional number: empty means "not known", which the check treats as needing a technician. */
function maybe(raw: string, label: string, allowZero = false) {
  if (!raw.trim()) return undefined;
  const n = Number(raw.replace(/[,\s]/g, ""));
  if (!Number.isFinite(n) || n < 0 || (!allowZero && n === 0)) throw new FormProblem(`${label}: enter a number, or leave it empty.`);
  return n;
}

/** Turns the form into what the server expects, or says what is still missing. */
export function toPayload(
  f: UpgradeFormState
): { ok: true; system: ExistingSystem; needs: UpgradeNeeds } | { ok: false; error: string } {
  try {
    const batteryless = f.systemType === "grid_tied" && !f.hasBatteries && !f.hasController;
    const system: ExistingSystem = { systemType: f.systemType };
    if (!batteryless) system.systemVoltage = need(f.systemVoltage, "System voltage");

    if (f.hasInverter) {
      system.inverter = {
        ratedW: need(f.inverterW, "Inverter power"),
        surgeW: maybe(f.inverterSurgeW, "Inverter surge power"),
        hasSolarInput: f.inverterHasSolar,
        maxPvPowerW: f.inverterHasSolar ? maybe(f.inverterPvPowerW, "Inverter solar input power") : undefined,
        maxPvVoltage: f.inverterHasSolar ? maybe(f.inverterPvVoltage, "Inverter maximum solar voltage") : undefined,
        mpptMinVoltage: f.inverterHasSolar ? maybe(f.inverterMpptMin, "Inverter MPPT minimum voltage") : undefined,
        maxPvCurrentA: f.inverterHasSolar ? maybe(f.inverterPvCurrentA, "Inverter solar input current") : undefined,
        maxChargeA: maybe(f.inverterChargeA, "Inverter charge current")
      };
    }
    if (f.hasController) {
      system.controller = {
        technology: f.controllerTech,
        maxChargeA: need(f.controllerA, "Charge controller current"),
        maxPvVoltage: maybe(f.controllerPvVoltage, "Charge controller maximum solar voltage"),
        maxPvPowerW: maybe(f.controllerPvPowerW, "Charge controller solar power")
      };
    }
    if (f.hasPanels) {
      system.panels = {
        count: need(f.panelCount, "Number of panels"),
        wp: need(f.panelWp, "Panel power"),
        perString: maybe(f.panelPerString, "Panels per string"),
        voc: maybe(f.panelVoc, "Panel Voc"),
        vmp: maybe(f.panelVmp, "Panel Vmp"),
        isc: maybe(f.panelIsc, "Panel Isc")
      };
    }
    if (f.hasBatteries) {
      system.batteries = {
        count: need(f.batteryCount, "Number of batteries"),
        nominalV: need(f.batteryV, "Battery voltage"),
        ah: need(f.batteryAh, "Battery capacity"),
        chemistry: f.batteryChemistry,
        ageYears: maybe(f.batteryAge, "Battery age", true)
      };
    }
    if (!system.inverter && !system.controller && !system.panels && !system.batteries) {
      throw new FormProblem("Describe at least one part of the system: the inverter, panels, batteries or charge controller.");
    }

    if (f.goals.length === 0) throw new FormProblem("Choose what you want to improve.");
    const needs: UpgradeNeeds = { goals: f.goals };
    if (f.goals.includes("battery")) {
      const hours = maybe(f.backupHours, "Backup hours");
      const load = maybe(f.backupLoadW, "Power to run during backup");
      if ((hours === undefined) !== (load === undefined)) {
        throw new FormProblem("Give both the backup hours and the power to run during backup, or leave both empty.");
      }
      needs.backupHours = hours;
      needs.backupLoadW = load;
    }
    if (f.goals.includes("panels")) needs.dailyKwh = maybe(f.dailyKwh, "Energy wanted from solar");
    if (f.goals.includes("inverter")) needs.peakLoadW = maybe(f.peakLoadW, "Most power at once");
    return { ok: true, system: clean(system), needs: clean(needs) };
  } catch (e) {
    if (e instanceof FormProblem) return { ok: false, error: e.message };
    throw e;
  }
}

/** Drops unset fields so they are sent as absent, not as empty values. */
function clean<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

const SYSTEM_TYPES: { value: SystemType; label: string; hint: string }[] = [
  { value: "hybrid", label: "Hybrid", hint: "Solar and batteries, with grid power as well." },
  { value: "off_grid", label: "Off-grid", hint: "Solar and batteries, no grid connection." },
  { value: "backup_only", label: "Backup only", hint: "Inverter and batteries charged from the grid. No panels yet." },
  { value: "grid_tied", label: "Grid-tied", hint: "Solar that feeds the building. No batteries." }
];

const GOALS: { value: Goal; label: string; hint: string }[] = [
  { value: "battery", label: "Longer backup", hint: "Add batteries or get a bigger bank." },
  { value: "panels", label: "More solar", hint: "Add panels to make more power." },
  { value: "inverter", label: "Run more at once", hint: "A bigger inverter or charge controller." },
  { value: "swaps", label: "Cheaper or better parts", hint: "See what could replace what is there." }
];

function Num({
  id, label, unit, value, onChange, hint, placeholder, required
}: {
  id: string;
  label: string;
  unit?: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <div className="upgrade-field">
      <label htmlFor={id}>
        {label}
        {unit ? <span className="upgrade-unit"> ({unit})</span> : null}
        {required ? null : <span className="step-optional">Optional</span>}
      </label>
      <input id={id} inputMode="decimal" autoComplete="off" placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />
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
  state, setState, audience
}: {
  state: UpgradeFormState;
  setState: Dispatch<SetStateAction<UpgradeFormState>>;
  audience: "public" | "staff";
}) {
  const set = <K extends keyof UpgradeFormState>(key: K, value: UpgradeFormState[K]) => setState((s) => ({ ...s, [key]: value }));
  const you = audience === "public";
  const f = state;
  const needsVoltage = !(f.systemType === "grid_tied" && !f.hasBatteries && !f.hasController);

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
      <section className="step step-1" aria-labelledby="up-q1">
        <h2 id="up-q1"><span className="step-num">1</span> What kind of system is it?</h2>
        <div className="choice-row" role="radiogroup" aria-labelledby="up-q1">
          {SYSTEM_TYPES.map((t) => (
            <button type="button" key={t.value} role="radio" aria-checked={f.systemType === t.value} className={`choice ${f.systemType === t.value ? "choice-on" : ""}`} onClick={() => chooseType(t.value)}>
              <strong>{t.label}</strong>
              <span>{t.hint}</span>
            </button>
          ))}
        </div>
        {needsVoltage ? (
          <div className="upgrade-field">
            <label htmlFor="up-voltage">System voltage <span className="upgrade-unit">(V)</span></label>
            <Chips label="Common system voltages" options={["12", "24", "48"]} value={f.systemVoltage} onChange={(v) => set("systemVoltage", v)} />
            <input id="up-voltage" inputMode="decimal" autoComplete="off" placeholder="Or type it" value={f.systemVoltage} onChange={(e) => set("systemVoltage", e.target.value)} />
            <p className="hint">
              The battery bank voltage. It is printed on the inverter or charge controller, for example &quot;48 V DC&quot;.
              Four 12 V batteries in a row make 48 V.
            </p>
          </div>
        ) : null}
      </section>

      <section className="step step-2" aria-labelledby="up-q2">
        <h2 id="up-q2"><span className="step-num">2</span> The inverter</h2>
        <label className="check-row" htmlFor="up-has-inv">
          <input id="up-has-inv" type="checkbox" checked={f.hasInverter} onChange={(e) => set("hasInverter", e.target.checked)} />
          There is an inverter
        </label>
        {f.hasInverter ? (
          <>
            <Num id="up-inv-w" required label="Power" unit="W" value={f.inverterW} onChange={(v) => set("inverterW", v)} placeholder="e.g. 3000"
              hint="Use the watt (W) figure on the label. If it only shows kVA, a 3 kVA inverter is often 2400 to 3000 W." />
            <label className="check-row" htmlFor="up-inv-solar">
              <input id="up-inv-solar" type="checkbox" checked={f.inverterHasSolar} onChange={(e) => set("inverterHasSolar", e.target.checked)} />
              The solar panels plug straight into this inverter
            </label>
            <details className="upgrade-more">
              <summary>More from the inverter label</summary>
              {f.inverterHasSolar ? (
                <div className="upgrade-grid">
                  <Num id="up-inv-pvw" label="Max solar input power" unit="W" value={f.inverterPvPowerW} onChange={(v) => set("inverterPvPowerW", v)} />
                  <Num id="up-inv-pvv" label="Max solar input voltage" unit="V" value={f.inverterPvVoltage} onChange={(v) => set("inverterPvVoltage", v)} />
                  <Num id="up-inv-mppt" label="MPPT minimum voltage" unit="V" value={f.inverterMpptMin} onChange={(v) => set("inverterMpptMin", v)} />
                  <Num id="up-inv-pva" label="Max solar input current" unit="A" value={f.inverterPvCurrentA} onChange={(v) => set("inverterPvCurrentA", v)} />
                </div>
              ) : null}
              <div className="upgrade-grid">
                <Num id="up-inv-charge" label="Max battery charge current" unit="A" value={f.inverterChargeA} onChange={(v) => set("inverterChargeA", v)} />
                <Num id="up-inv-surge" label="Surge power" unit="W" value={f.inverterSurgeW} onChange={(v) => set("inverterSurgeW", v)} />
              </div>
              <p className="hint">
                Leave empty anything {you ? "you" : "the customer"} cannot find. It is then marked for a technician to confirm instead of being guessed.
              </p>
            </details>
          </>
        ) : null}

        <label className="check-row" htmlFor="up-has-ctl">
          <input id="up-has-ctl" type="checkbox" checked={f.hasController} onChange={(e) => set("hasController", e.target.checked)} />
          There is a separate solar charge controller
        </label>
        {f.hasController ? (
          <>
            <div className="segmented" role="radiogroup" aria-label="Charge controller type">
              {(["MPPT", "PWM"] as const).map((t) => (
                <button key={t} type="button" role="radio" aria-checked={f.controllerTech === t} className={f.controllerTech === t ? "segmented-on" : ""} onClick={() => set("controllerTech", t)}>
                  {t}
                </button>
              ))}
            </div>
            <div className="upgrade-grid">
              <Num id="up-ctl-a" required label="Rated current" unit="A" value={f.controllerA} onChange={(v) => set("controllerA", v)} placeholder="e.g. 60" />
              <Num id="up-ctl-v" label="Max solar voltage" unit="V" value={f.controllerPvVoltage} onChange={(v) => set("controllerPvVoltage", v)} placeholder="e.g. 150" />
              <Num id="up-ctl-w" label="Max solar power" unit="W" value={f.controllerPvPowerW} onChange={(v) => set("controllerPvPowerW", v)} />
            </div>
          </>
        ) : null}
      </section>

      <section className="step step-3" aria-labelledby="up-q3">
        <h2 id="up-q3"><span className="step-num">3</span> Panels and batteries</h2>
        <label className="check-row" htmlFor="up-has-pv">
          <input id="up-has-pv" type="checkbox" checked={f.hasPanels} onChange={(e) => set("hasPanels", e.target.checked)} />
          There are solar panels
        </label>
        {f.hasPanels ? (
          <>
            <div className="upgrade-grid">
              <Num id="up-pv-n" required label="How many panels" value={f.panelCount} onChange={(v) => set("panelCount", v)} />
              <Num id="up-pv-w" required label="Power of each" unit="W" value={f.panelWp} onChange={(v) => set("panelWp", v)} placeholder="e.g. 330" />
              <Num id="up-pv-s" label="Panels in each string" value={f.panelPerString} onChange={(v) => set("panelPerString", v)}
                hint="How many are wired one after another in a row before reaching the controller." />
            </div>
            <details className="upgrade-more">
              <summary>From the label on the back of a panel</summary>
              <div className="upgrade-grid">
                <Num id="up-pv-voc" label="Open-circuit voltage, Voc" unit="V" value={f.panelVoc} onChange={(v) => set("panelVoc", v)} />
                <Num id="up-pv-vmp" label="Voltage at max power, Vmp" unit="V" value={f.panelVmp} onChange={(v) => set("panelVmp", v)} />
                <Num id="up-pv-isc" label="Short-circuit current, Isc" unit="A" value={f.panelIsc} onChange={(v) => set("panelIsc", v)} />
              </div>
              <p className="hint">These let the check match new panels to the old strings. Without them, the match is left for a technician.</p>
            </details>
          </>
        ) : null}

        <label className="check-row" htmlFor="up-has-bat">
          <input id="up-has-bat" type="checkbox" checked={f.hasBatteries} onChange={(e) => set("hasBatteries", e.target.checked)} />
          There are batteries
        </label>
        {f.hasBatteries ? (
          <>
            <div className="upgrade-grid">
              <Num id="up-bat-n" required label="How many batteries" value={f.batteryCount} onChange={(v) => set("batteryCount", v)} />
              <div className="upgrade-field">
                <label htmlFor="up-bat-v">Voltage of each <span className="upgrade-unit">(V)</span></label>
                <Chips label="Common battery voltages" options={["12", "24", "48", "51.2"]} value={f.batteryV} onChange={(v) => set("batteryV", v)} />
                <input id="up-bat-v" inputMode="decimal" autoComplete="off" placeholder="Or type it" value={f.batteryV} onChange={(e) => set("batteryV", e.target.value)} />
              </div>
              <Num id="up-bat-ah" required label="Capacity of each" unit="Ah" value={f.batteryAh} onChange={(v) => set("batteryAh", v)} placeholder="e.g. 200" />
              <Num id="up-bat-age" label="Age" unit="years" value={f.batteryAge} onChange={(v) => set("batteryAge", v)} />
            </div>
            <p className="field-label" id="up-chem">Battery type</p>
            <div className="choice-row" role="radiogroup" aria-labelledby="up-chem">
              {([
                ["lithium", "Lithium", "LiFePO4 or other lithium, usually with a display or BMS."],
                ["lead_acid", "Lead-acid", "AGM, gel, tubular or flooded. Heavy, like a large car battery."],
                ["unknown", "Not sure", "A technician will check."]
              ] as const).map(([value, label, hint]) => (
                <button type="button" key={value} role="radio" aria-checked={f.batteryChemistry === value} className={`choice ${f.batteryChemistry === value ? "choice-on" : ""}`} onClick={() => set("batteryChemistry", value)}>
                  <strong>{label}</strong>
                  <span>{hint}</span>
                </button>
              ))}
            </div>
          </>
        ) : null}
      </section>

      <section className="step step-4" aria-labelledby="up-q4">
        <h2 id="up-q4"><span className="step-num">4</span> What {you ? "do you" : "does the customer"} want to improve?</h2>
        <div className="choice-row" role="group" aria-labelledby="up-q4">
          {GOALS.map((g) => (
            <button type="button" key={g.value} aria-pressed={f.goals.includes(g.value)} className={`choice ${f.goals.includes(g.value) ? "choice-on" : ""}`} onClick={() => toggleGoal(g.value)}>
              <strong>{f.goals.includes(g.value) ? "✓ " : ""}{g.label}</strong>
              <span>{g.hint}</span>
            </button>
          ))}
        </div>
        {f.goals.includes("battery") ? (
          <div className="upgrade-grid">
            <Num id="up-need-h" label="Hours of backup wanted" unit="h" value={f.backupHours} onChange={(v) => set("backupHours", v)} placeholder="e.g. 8" />
            <Num id="up-need-w" label="Power to run during backup" unit="W" value={f.backupLoadW} onChange={(v) => set("backupLoadW", v)} placeholder="e.g. 500"
              hint="Lights, a TV and a fridge together are roughly 300 to 500 W." />
          </div>
        ) : null}
        {f.goals.includes("panels") ? (
          <Num id="up-need-kwh" label="Energy wanted from solar each day" unit="kWh" value={f.dailyKwh} onChange={(v) => set("dailyKwh", v)} placeholder="e.g. 8"
            hint="One Yaka unit is 1 kWh. 150 units a month is about 5 kWh a day. Leave empty to see how many panels fit." />
        ) : null}
        {f.goals.includes("inverter") ? (
          <Num id="up-need-peak" label="Most power running at the same time" unit="W" value={f.peakLoadW} onChange={(v) => set("peakLoadW", v)} placeholder="e.g. 3500"
            hint="Add up the appliances that may be on together. Leave empty to see like-for-like replacements." />
        ) : null}
      </section>
    </>
  );
}
