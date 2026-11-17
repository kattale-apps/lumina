import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

/** One appliance as it was when the customer pressed calculate. */
export type ReportLine = {
  name: string;
  powerW: number;
  quantity: number;
  hoursPerDay: number;
  /** Share of the on-hours it actually draws power (fridges etc.). */
  duty: number;
};

export type UsageReportData = {
  companyName: string;
  customerType: string;
  currency: string;
  exponent: number;
  rateMinorPerKwh: number | null;
  dailyKwh: number;
  peakW: number;
  basis: "bill" | "appliances";
  lines: ReportLine[];
  /** The solar options recommended on screen. Parts and sizes only: never prices. */
  options?: ReportOption[];
};

export type ReportOption = {
  title: string;
  blurb: string;
  components: string[];
  figures: string[];
  notes: string[];
};

const DAYS_PER_WEEK = 7;
const DAYS_PER_MONTH = 30; // matches the on-screen monthly figure
const DAYS_PER_YEAR = 365;

export const REPORT_CAVEAT =
  "ESTIMATE ONLY. These figures are calculated from typical appliance ratings and the hours you entered. " +
  "Your actual use and cost depend on your appliances, how you use them, and the tariff on your bill. " +
  "This is not a bill, a meter reading or a quotation.";

// Standard PDF fonts only cover Latin-1 style characters; replace anything else.
function safe(text: string) {
  return text
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—−]/g, "-")
    .replace(/×/g, "x")
    .replace(/[^\x20-\x7e -ÿ]/g, "");
}

function wrap(text: string, font: PDFFont, size: number, width: number) {
  const words = safe(text).split(/\s+/);
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

function clip(text: string, font: PDFFont, size: number, width: number) {
  let t = safe(text);
  if (font.widthOfTextAtSize(t, size) <= width) return t;
  while (t.length > 1 && font.widthOfTextAtSize(`${t}...`, size) > width) t = t.slice(0, -1);
  return `${t}...`;
}

export async function buildUsageReport(data: UsageReportData): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle("Energy usage estimate");
  pdf.setProducer("Solar Switch");
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const W = 842; // A4 landscape
  const H = 595;
  const M = 36;
  const ink = rgb(0.09, 0.16, 0.14);
  const muted = rgb(0.39, 0.45, 0.43);
  const green = rgb(0.09, 0.42, 0.29);
  const amberBg = rgb(1, 0.96, 0.85);
  const amberLine = rgb(0.85, 0.6, 0.1);
  const lineGrey = rgb(0.88, 0.91, 0.89);

  const rate = data.rateMinorPerKwh;
  const unit = 10 ** data.exponent;
  const money = (minor: number | null) =>
    minor === null
      ? "-"
      : `${(minor / unit).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: data.exponent })}`;
  const costOf = (kwh: number) => (rate === null ? null : Math.round(kwh * rate));

  let page: PDFPage = pdf.addPage([W, H]);
  let y = H - M;

  const text = (t: string, x: number, size: number, f = font, color = ink) =>
    page.drawText(safe(t), { x, y, size, font: f, color });
  const right = (t: string, xRight: number, size: number, f = font, color = ink) =>
    page.drawText(safe(t), { x: xRight - f.widthOfTextAtSize(safe(t), size), y, size, font: f, color });

  function caveatBox() {
    const body = wrap(REPORT_CAVEAT.replace(/^ESTIMATE ONLY\.\s*/, ""), font, 9, W - 2 * M - 24);
    const h = 26 + (body.length + 1) * 12;
    const top = y + 12;
    page.drawRectangle({ x: M, y: top - h, width: W - 2 * M, height: h, color: amberBg, borderColor: amberLine, borderWidth: 1 });
    y = top - 20;
    page.drawText("ESTIMATE ONLY", { x: M + 12, y, size: 10, font: bold, color: ink });
    y -= 13;
    for (const l of body) {
      page.drawText(l, { x: M + 12, y, size: 9, font, color: ink });
      y -= 12;
    }
    y = top - h - 22;
  }

  // Header
  text("ENERGY USAGE ESTIMATE", M, 9, bold, green);
  right(new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }), W - M, 9, font, muted);
  y -= 22;
  text(data.companyName, M, 20, bold);
  y -= 18;
  const meta = [
    data.customerType ? `Customer type: ${data.customerType}` : "",
    rate !== null ? `Electricity price used: ${data.currency} ${money(rate)} per kWh` : "No electricity price available - costs not shown",
    data.basis === "bill" ? "Based on: your electricity bill / token" : "Based on: the appliances you entered"
  ].filter(Boolean);
  text(meta.join("   |   "), M, 9, font, muted);
  y -= 22;
  caveatBox();

  // Summary tiles
  // With an appliance list, use the exact sum so the tiles match the table totals to the shilling.
  const exactKwh = data.lines.reduce((s, l) => {
    const k = (l.powerW * l.quantity * l.hoursPerDay * l.duty) / 1000;
    return s + (Number.isFinite(k) && k > 0 ? k : 0);
  }, 0);
  const daily = data.basis === "appliances" && data.lines.length > 0 ? exactKwh : data.dailyKwh;
  const tiles: [string, string][] = [
    ["Energy per day", `${daily.toFixed(2)} kWh`],
    ["Cost per day", rate === null ? "-" : `${data.currency} ${money(costOf(daily))}`],
    ["Cost per week", rate === null ? "-" : `${data.currency} ${money(costOf(daily * DAYS_PER_WEEK))}`],
    ["Cost per month (30 days)", rate === null ? "-" : `${data.currency} ${money(costOf(daily * DAYS_PER_MONTH))}`],
    ["Cost per year", rate === null ? "-" : `${data.currency} ${money(costOf(daily * DAYS_PER_YEAR))}`],
    ["Busiest moment", `${data.peakW.toLocaleString("en-US")} W`]
  ];
  const tileW = (W - 2 * M - 5 * 8) / 6;
  tiles.forEach(([label, value], i) => {
    const x = M + i * (tileW + 8);
    page.drawRectangle({ x, y: y - 34, width: tileW, height: 44, borderColor: lineGrey, borderWidth: 1, color: rgb(1, 1, 1) });
    page.drawText(safe(label), { x: x + 8, y: y - 2, size: 8, font, color: muted });
    page.drawText(clip(value, bold, 12, tileW - 16), { x: x + 8, y: y - 22, size: 12, font: bold, color: ink });
  });
  y -= 62;

  if (data.basis === "appliances" && data.lines.length > 0) {
    // Columns: name, watts, qty, hours, kWh/day, then cost per hour/day/week/month/year.
    const cols = [
      { h: "Appliance", w: 190, align: "left" as const },
      { h: "Watts", w: 50 },
      { h: "Qty", w: 32 },
      { h: "Hrs/day", w: 46 },
      { h: "kWh/day", w: 54 },
      { h: "Per hour*", w: 70 },
      { h: "Per day", w: 70 },
      { h: "Per week", w: 72 },
      { h: "Per month", w: 78 },
      { h: "Per year", w: 0 }
    ];
    const used = cols.reduce((s, c) => s + c.w, 0);
    cols[cols.length - 1].w = W - 2 * M - used;
    const xs: number[] = [];
    cols.reduce((x, c) => (xs.push(x), x + c.w), M);

    const header = () => {
      text(rate === null ? "By appliance" : `By appliance (costs in ${data.currency})`, M, 11, bold);
      y -= 16;
      page.drawRectangle({ x: M, y: y - 5, width: W - 2 * M, height: 18, color: rgb(0.94, 0.97, 0.95) });
      cols.forEach((c, i) => {
        if (c.align === "left") text(c.h, xs[i] + 4, 8, bold, muted);
        else right(c.h, xs[i] + c.w - 4, 8, bold, muted);
      });
      y -= 18;
    };
    header();

    let totals = { w: 0, kwh: 0, hour: 0 };
    for (const l of data.lines) {
      if (y < M + 70) {
        page = pdf.addPage([W, H]);
        y = H - M;
        header();
      }
      const valid = [l.powerW, l.quantity, l.hoursPerDay].every((n) => Number.isFinite(n) && n > 0);
      const kwh = valid ? (l.powerW * l.quantity * l.hoursPerDay * l.duty) / 1000 : 0;
      const kwPerHour = valid ? (l.powerW * l.quantity * l.duty) / 1000 : 0;
      totals = { w: totals.w + (valid ? l.powerW * l.quantity : 0), kwh: totals.kwh + kwh, hour: totals.hour + kwPerHour };
      const cells = [
        l.name + (l.duty < 1 ? " **" : ""),
        l.powerW.toLocaleString("en-US"),
        String(l.quantity),
        String(l.hoursPerDay),
        kwh.toFixed(2),
        money(costOf(kwPerHour)),
        money(costOf(kwh)),
        money(costOf(kwh * DAYS_PER_WEEK)),
        money(costOf(kwh * DAYS_PER_MONTH)),
        money(costOf(kwh * DAYS_PER_YEAR))
      ];
      cells.forEach((c, i) => {
        if (cols[i].align === "left") text(clip(c, font, 8.5, cols[i].w - 8), xs[i] + 4, 8.5);
        else right(c, xs[i] + cols[i].w - 4, 8.5);
      });
      y -= 6;
      page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.5, color: lineGrey });
      y -= 11;
    }

    // Totals row
    const totalCells = [
      "Total (all appliances)",
      totals.w.toLocaleString("en-US"),
      "",
      "",
      totals.kwh.toFixed(2),
      money(costOf(totals.hour)),
      money(costOf(totals.kwh)),
      money(costOf(totals.kwh * DAYS_PER_WEEK)),
      money(costOf(totals.kwh * DAYS_PER_MONTH)),
      money(costOf(totals.kwh * DAYS_PER_YEAR))
    ];
    totalCells.forEach((c, i) => {
      if (cols[i].align === "left") text(c, xs[i] + 4, 9, bold);
      else right(c, xs[i] + cols[i].w - 4, 9, bold);
    });
    y -= 20;

    const notes = [
      "* Per hour = the cost of one hour while the appliance (all of that quantity) is switched on.",
      "Watts total = everything switched on at once. Week = 7 days, month = 30 days, year = 365 days."
    ];
    if (data.lines.some((l) => l.duty < 1)) {
      notes.push("** Fridges, freezers, air conditioners and similar switch on and off by themselves, so only part of their hours is counted.");
    }
    for (const n of notes) {
      text(n, M, 8, font, muted);
      y -= 11;
    }
  } else {
    const avgW = (daily * 1000) / 24;
    text("From your bill", M, 11, bold);
    y -= 16;
    const rows: [string, string][] = [
      ["Average power drawn", `${Math.round(avgW).toLocaleString("en-US")} W`],
      ["Average cost per hour", rate === null ? "-" : `${data.currency} ${money(costOf(daily / 24))}`],
      ["Cost per day", rate === null ? "-" : `${data.currency} ${money(costOf(daily))}`],
      ["Cost per week", rate === null ? "-" : `${data.currency} ${money(costOf(daily * DAYS_PER_WEEK))}`],
      ["Cost per month (30 days)", rate === null ? "-" : `${data.currency} ${money(costOf(daily * DAYS_PER_MONTH))}`],
      ["Cost per year", rate === null ? "-" : `${data.currency} ${money(costOf(daily * DAYS_PER_YEAR))}`]
    ];
    for (const [k, v] of rows) {
      text(k, M + 4, 10);
      right(v, M + 360, 10, bold);
      y -= 6;
      page.drawLine({ start: { x: M, y }, end: { x: M + 364, y }, thickness: 0.5, color: lineGrey });
      y -= 12;
    }
    y -= 4;
    text("Bill-based figures are spread evenly over the day. Add your appliances for a per-appliance breakdown.", M, 8, font, muted);
    y -= 11;
  }

  // Recommended solar options, as shown on screen. No prices.
  if (data.options && data.options.length > 0) {
    page = pdf.addPage([W, H]);
    y = H - M;
    const room = (needed: number) => {
      if (y < M + needed) {
        page = pdf.addPage([W, H]);
        y = H - M;
      }
    };
    text("RECOMMENDED SOLAR OPTIONS", M, 9, bold, green);
    y -= 20;
    text("Systems that could fit the energy use in this report", M, 16, bold);
    y -= 16;
    for (const l of wrap(
      "For illustration only. A technician checks every design before it is final. Prices are not shown in this report: " +
        "create a free account to see our best prices, or request a quotation.",
      font, 9, W - 2 * M
    )) {
      text(l, M, 9, font, muted);
      y -= 12;
    }
    y -= 8;
    data.options.forEach((o, i) => {
      room(90);
      page.drawRectangle({ x: M, y: y - 5, width: W - 2 * M, height: 20, color: rgb(0.94, 0.97, 0.95) });
      text(`Option ${i + 1}: ${o.title}`, M + 6, 11, bold);
      y -= 20;
      for (const l of wrap(o.blurb, font, 9, W - 2 * M - 12)) {
        room(30);
        text(l, M + 6, 9, font, muted);
        y -= 12;
      }
      y -= 2;
      for (const c of o.components) {
        for (const [n, l] of wrap(c, font, 9.5, W - 2 * M - 30).entries()) {
          room(30);
          if (n === 0) text("-", M + 10, 9.5);
          text(l, M + 20, 9.5);
          y -= 13;
        }
      }
      for (const f of o.figures) {
        room(30);
        text(f, M + 6, 9.5, bold);
        y -= 13;
      }
      for (const note of o.notes) {
        for (const l of wrap(note, font, 8.5, W - 2 * M - 12)) {
          room(30);
          text(l, M + 6, 8.5, font, muted);
          y -= 11;
        }
      }
      y -= 12;
    });
  }

  // Footer caveat on every page
  for (const p of pdf.getPages()) {
    const foot = "Estimate only - not a bill or a quotation. A technician confirms every solar design.";
    p.drawText(foot, { x: M, y: 20, size: 7.5, font, color: muted });
  }

  return await pdf.save();
}
