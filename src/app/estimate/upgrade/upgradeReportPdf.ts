import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { money, type Report } from "./UpgradeReport";

export type UpgradeReportPdfData = {
  companyName: string;
  /** Who the report is for, when known. */
  customerName?: string;
  preparedAt: number;
  systemLines: string[];
  needsLines: string[];
  report: Report;
  /** Keys of the options that were chosen, if any; they are marked in the report. */
  selected: string[];
  verification?: { note: string; verifierName: string; verifiedAt: number } | null;
};

const BANNER = "UNVERIFIED - FOR ILLUSTRATION ONLY";
const PAGE = { w: 595, h: 842 };
const MARGIN = 46;
const WIDTH = PAGE.w - MARGIN * 2;

// Standard PDF fonts only cover Latin-1 style characters; replace anything else.
function safe(text: string) {
  return text
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—−]/g, "-")
    .replace(/×/g, "x")
    .replace(/[✓]/g, "")
    .replace(/[^\x20-\x7e\xa0-\xff]/g, "");
}

function wrap(text: string, font: PDFFont, size: number, width: number) {
  const words = safe(text).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (font.widthOfTextAtSize(next, size) > width && line) {
      lines.push(line);
      line = w;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * The upgrade report as a PDF. Every page is created through `newPage`, which
 * draws the unverified banner, so no page can be added without it.
 */
export async function buildUpgradeReportPdf(data: UpgradeReportPdfData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle("Solar system upgrade report");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.09, 0.16, 0.14);
  const muted = rgb(0.39, 0.45, 0.43);
  const green = rgb(0.09, 0.42, 0.29);
  const red = rgb(0.7, 0.1, 0.1);
  const verified = Boolean(data.verification);

  let page: PDFPage;
  let y = 0;
  const newPage = () => {
    page = doc.addPage([PAGE.w, PAGE.h]);
    page.drawRectangle({ x: 0, y: PAGE.h - 28, width: PAGE.w, height: 28, color: red });
    page.drawText(BANNER, { x: MARGIN, y: PAGE.h - 19, size: 11, font: bold, color: rgb(1, 1, 1) });
    y = PAGE.h - 56;
  };
  newPage();

  const room = (needed: number) => {
    if (y - needed < 56) newPage();
  };
  const para = (text: string, opts: { size?: number; font?: PDFFont; color?: ReturnType<typeof rgb>; indent?: number; gap?: number } = {}) => {
    const size = opts.size ?? 10;
    const f = opts.font ?? font;
    const indent = opts.indent ?? 0;
    for (const line of wrap(text, f, size, WIDTH - indent)) {
      room(size + 4);
      page.drawText(line, { x: MARGIN + indent, y, size, font: f, color: opts.color ?? ink });
      y -= size + 4;
    }
    y -= opts.gap ?? 0;
  };
  const heading = (text: string) => {
    room(40);
    y -= 8;
    para(text, { size: 13, font: bold, color: green, gap: 2 });
  };
  const bullet = (text: string, color = ink) => {
    const lines = wrap(text, font, 10, WIDTH - 14);
    lines.forEach((line, i) => {
      room(14);
      if (i === 0) page.drawText("-", { x: MARGIN + 2, y, size: 10, font, color });
      page.drawText(line, { x: MARGIN + 14, y, size: 10, font, color });
      y -= 14;
    });
  };

  const { report } = data;
  para(data.companyName, { size: 11, font: bold, color: muted });
  para("Solar system upgrade report", { size: 20, font: bold, gap: 2 });
  const date = new Date(data.preparedAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  para([data.customerName ? `Prepared for ${data.customerName}` : "", date].filter(Boolean).join("  |  "), { color: muted, gap: 6 });
  para(
    "This report is calculated from equipment ratings that were typed in and have not been inspected. " +
      "It shows what could fit; it is not a design, an offer or a price commitment. " +
      "A technician must verify the existing equipment before any quotation is approved.",
    { size: 9, color: muted, gap: 4 }
  );
  if (data.verification) {
    const when = new Date(data.verification.verifiedAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
    para(`Ratings verified by ${data.verification.verifierName} on ${when}: ${data.verification.note}`, { size: 9, font: bold, color: green, gap: 4 });
  }

  heading("The existing system, as reported");
  data.systemLines.forEach((l) => bullet(l));
  y -= 4;
  data.needsLines.forEach((l) => bullet(l));

  if (report.blockers.length > 0) {
    heading("The details do not add up yet");
    report.blockers.forEach((b) => bullet(b, red));
    return await doc.save();
  }

  heading("How it stands today");
  const c = report.current;
  if (c.arrayWp > 0) bullet(`Solar array: ${c.arrayWp} Wp, about ${(c.solarWhPerDay / 1000).toFixed(1)} kWh on a design day.`);
  if (c.batteryNominalWh > 0) {
    bullet(
      `Battery bank: ${(c.batteryNominalWh / 1000).toFixed(1)} kWh nominal, about ${(c.batteryUsableWh / 1000).toFixed(1)} kWh usable` +
        (c.backupHours !== null ? `, about ${c.backupHours} h at the stated backup load.` : ".")
    );
  }
  if (c.inverterW !== null) bullet(`Inverter: ${c.inverterW} W continuous.`);
  if (c.chargerLimitWp !== null) bullet(`Solar charger accepts up to ${c.chargerLimitWp} W of panels.`);
  for (const f of report.findings) {
    const mark = f.state === "pass" ? "OK" : f.state === "fail" ? "PROBLEM" : "TO CONFIRM";
    bullet(`[${mark}] ${f.label}. ${f.detail}`, f.state === "fail" ? red : ink);
  }

  for (const s of report.sections) {
    heading(s.title);
    s.messages.forEach((m) => para(m, { gap: 2 }));
    if (s.requirements.length > 0) {
      para("What anything added here must match:", { font: bold });
      s.requirements.forEach((r) => bullet(r));
      y -= 4;
    }
    if (s.options.length === 0) para("No catalogue product fits here yet. A technician can recommend one.", { color: muted });
    for (const o of s.options) {
      room(60);
      const chosen = data.selected.includes(o.key);
      para(`${chosen ? "[CHOSEN] " : ""}${o.title}`, { font: bold, size: 11 });
      para(o.summary, { indent: 10 });
      const details = [
        [o.brand, o.model, o.sku ? `SKU ${o.sku}` : ""].filter(Boolean).join(" "),
        o.totalMinor !== null && o.unitListMinor !== null
          ? `List price ${money(o.totalMinor, report.exponent, report.currency)} (${o.quantity} x ${money(o.unitListMinor, report.exponent, report.currency)}), subject to verification`
          : "",
        o.tags.join(", ")
      ].filter(Boolean);
      if (details.length) para(details.join("  |  "), { indent: 10, size: 9, color: muted });
      const open = o.checks.filter((k) => k.state === "review");
      if (open.length === 0) para("Fits the ratings given.", { indent: 10, size: 9, color: green });
      for (const k of open) para(`To confirm - ${k.label}: ${k.detail}`, { indent: 10, size: 9 });
      y -= 6;
    }
    if (s.rejected.length > 0) {
      para("Left out:", { size: 9, font: bold, color: muted });
      s.rejected.forEach((r) => para(r, { size: 9, color: muted, indent: 10 }));
    }
  }

  heading("Assumptions");
  bullet(`${report.assumptions.peakSunHours} useful sun hours a day and ${Math.round(report.assumptions.performanceRatio * 100)}% system performance.`);
  bullet(`String voltages checked for cells at ${report.assumptions.minCellTempC} °C (cold morning) and ${report.assumptions.maxCellTempC} °C (hot day).`);
  bullet("Usable battery energy uses the manufacturer's depth of discharge where known, otherwise 80% for lithium and 50% for lead-acid.");
  bullet(`Calculation engine ${report.engineVersion}. ${verified ? "Ratings verified by a technician." : "Ratings not yet verified by a technician."}`);

  return await doc.save();
}
