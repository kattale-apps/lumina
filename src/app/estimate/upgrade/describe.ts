import type { FunctionArgs } from "convex/server";
import type { api } from "../../../../convex/_generated/api";

export type ExistingSystem = FunctionArgs<typeof api.upgrades.simulate>["system"];
export type UpgradeNeeds = FunctionArgs<typeof api.upgrades.simulate>["needs"];
export type Goal = UpgradeNeeds["goals"][number];

export const SYSTEM_TYPE_LABEL: Record<ExistingSystem["systemType"], string> = {
  hybrid: "Hybrid",
  off_grid: "Off-grid",
  backup_only: "Backup only",
  grid_tied: "Grid-tied"
};

export const GOAL_LABEL: Record<Goal, string> = {
  battery: "Longer backup",
  panels: "More solar",
  inverter: "More power at once",
  swaps: "Cheaper or better parts",
  repair: "Fix a faulty or worn-out part"
};

export const FAULTY_PART_LABEL: Record<NonNullable<UpgradeNeeds["faultyParts"]>[number], string> = {
  inverter: "Inverter",
  battery: "Batteries",
  panels: "Panels",
  controller: "Charge controller"
};

const CHEMISTRY_LABEL = { lithium: "lithium", lead_acid: "lead-acid", unknown: "chemistry not known" } as const;

/** The reported system in plain lines, for summaries and the PDF report. */
export function describeSystem(system: ExistingSystem): string[] {
  const lines = [
    `${SYSTEM_TYPE_LABEL[system.systemType]} system` + (system.systemVoltage ? `, ${system.systemVoltage} V battery bank` : "")
  ];
  if (system.inverter) {
    const i = system.inverter;
    const pv = [
      i.maxPvPowerW ? `up to ${i.maxPvPowerW} W` : "",
      i.maxPvVoltage ? `${i.maxPvVoltage} V max` : "",
      i.mpptMinVoltage ? `MPPT from ${i.mpptMinVoltage} V` : "",
      i.maxPvCurrentA ? `${i.maxPvCurrentA} A` : ""
    ].filter(Boolean);
    lines.push(
      `Inverter: ${i.ratedW} W` +
        (i.surgeW ? `, ${i.surgeW} W surge` : "") +
        (i.hasSolarInput ? `, panels connect to it${pv.length ? ` (${pv.join(", ")})` : ""}` : "") +
        (i.maxChargeA ? `, charges at up to ${i.maxChargeA} A` : "")
    );
  }
  if (system.controller) {
    const c = system.controller;
    lines.push(
      `Charge controller: ${c.technology}, ${c.maxChargeA} A` +
        (c.maxPvVoltage ? `, ${c.maxPvVoltage} V max solar` : "") +
        (c.maxPvPowerW ? `, ${c.maxPvPowerW} W max solar` : "")
    );
  }
  if (system.panels) {
    const p = system.panels;
    const specs = [p.voc ? `Voc ${p.voc} V` : "", p.vmp ? `Vmp ${p.vmp} V` : "", p.isc ? `Isc ${p.isc} A` : ""].filter(Boolean);
    lines.push(
      `Panels: ${p.count} × ${p.wp} W` +
        (p.perString ? `, ${p.perString} per string` : "") +
        (specs.length ? ` (${specs.join(", ")})` : "")
    );
  }
  if (system.batteries) {
    const b = system.batteries;
    lines.push(
      `Batteries: ${b.count} × ${b.nominalV} V ${b.ah} Ah, ${CHEMISTRY_LABEL[b.chemistry]}` +
        (b.ageYears !== undefined ? `, about ${b.ageYears} year${b.ageYears === 1 ? "" : "s"} old` : "")
    );
  }
  return lines;
}

/** What the owner asked for, in plain lines. */
export function describeNeeds(needs: UpgradeNeeds): string[] {
  const lines = [`Wants: ${needs.goals.map((g) => GOAL_LABEL[g].toLowerCase()).join(", ")}`];
  if (needs.backupHours !== undefined && needs.backupLoadW !== undefined) {
    lines.push(`Backup: ${needs.backupLoadW} W for ${needs.backupHours} h`);
  }
  if (needs.dailyKwh !== undefined) lines.push(`Solar energy wanted: ${needs.dailyKwh} kWh a day`);
  if (needs.peakLoadW !== undefined) lines.push(`Most power at once: ${needs.peakLoadW} W`);
  if (needs.faultyParts?.length) {
    lines.push(`Faulty or worn out: ${needs.faultyParts.map((p) => FAULTY_PART_LABEL[p].toLowerCase()).join(", ")}`);
  }
  if (needs.faultNote) lines.push(`What is wrong: ${needs.faultNote}`);
  return lines;
}
