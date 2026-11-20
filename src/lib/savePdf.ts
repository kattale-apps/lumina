/**
 * Saves a generated PDF for the user, on any device.
 *
 * - Android app: the file goes to the share sheet (save to Files, open, WhatsApp, email).
 * - iPhone, and the browsers inside WhatsApp, Facebook, Instagram and similar apps, cannot save a
 *   file made on the page: the phone's share sheet is used instead ("Save to Files", WhatsApp…).
 * - Normal browsers (laptops, Android Chrome): an ordinary download.
 * - Whenever none of that is possible (older app builds, no share sheet, a refused download), the
 *   PDF is uploaded for a private one-hour link and an "Open PDF" button appears, which works
 *   anywhere a web link opens.
 */

type CapacitorGlobal = {
  isNativePlatform?: () => boolean;
  isPluginAvailable?: (name: string) => boolean;
};

export type PdfLabels = {
  ready: string;
  open: string;
  hint: string;
  close: string;
};

const ENGLISH: PdfLabels = {
  ready: "Your PDF is ready",
  open: "Open PDF",
  hint: "Tap to open or download it. The link works for one hour.",
  close: "Close"
};

function capacitor(): CapacitorGlobal | undefined {
  return (globalThis as { Capacitor?: CapacitorGlobal }).Capacitor;
}

export function isNativeApp() {
  return Boolean(capacitor()?.isNativePlatform?.());
}

/** Kept for callers that still check for it; the app no longer needs updating to save PDFs. */
export class AppUpdateNeeded extends Error {
  constructor() {
    super("Update the Solar Switch app to save PDF reports.");
  }
}

/** Where a page cannot save a file it made itself, so the share sheet or a link is used instead. */
export function cannotDownloadHere(userAgent: string, standalone: boolean) {
  const inAppBrowser = /FBAN|FBAV|FB_IAB|Instagram|WhatsApp|Line\/|Snapchat|TikTok|MicroMessenger|; wv\)/i.test(userAgent);
  const iOS = /iPhone|iPad|iPod/i.test(userAgent) || (/Macintosh/i.test(userAgent) && /Mobile/i.test(userAgent));
  return inAppBrowser || iOS || standalone;
}

function toBase64(bytes: Uint8Array) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** The Convex HTTP address of this deployment (the same rule the app inbox uses). */
function siteUrl() {
  const site = process.env.NEXT_PUBLIC_CONVEX_SITE_URL;
  if (site) return site.replace(/\/+$/, "");
  return (process.env.NEXT_PUBLIC_CONVEX_URL ?? "").replace(/\.convex\.cloud\/?$/, ".convex.site");
}

/** Uploads the PDF for a private one-hour link. */
export async function pdfLink(bytes: Uint8Array, filename: string): Promise<string> {
  const res = await fetch(`${siteUrl()}/pdf-link`, {
    method: "POST",
    headers: { "Content-Type": "application/pdf", "X-Filename": filename },
    body: bytes as BodyInit
  });
  if (!res.ok) throw new Error(`pdf-link ${res.status}`);
  return ((await res.json()) as { url: string }).url;
}

/** A card at the bottom of the screen with a big button that opens the PDF. */
function showOpenButton(url: string, labels: PdfLabels) {
  document.getElementById("pdf-ready")?.remove();
  const card = document.createElement("div");
  card.id = "pdf-ready";
  card.className = "pdf-ready";
  card.setAttribute("role", "status");
  const title = document.createElement("strong");
  title.textContent = `📄 ${labels.ready}`;
  const hint = document.createElement("p");
  hint.textContent = labels.hint;
  const open = document.createElement("a");
  open.className = "button";
  open.href = url;
  open.target = "_blank";
  open.rel = "noopener";
  open.textContent = labels.open;
  const close = document.createElement("button");
  close.type = "button";
  close.className = "pdf-ready-close";
  close.setAttribute("aria-label", labels.close);
  close.textContent = "×";
  close.onclick = () => card.remove();
  open.onclick = () => setTimeout(() => card.remove(), 1500);
  card.append(close, title, hint, open);
  document.body.appendChild(card);
}

async function viaLink(bytes: Uint8Array, filename: string, labels: PdfLabels) {
  showOpenButton(await pdfLink(bytes, filename), labels);
}

/** The phone's share sheet with the PDF attached. False when the device has none for files. */
async function viaShareSheet(bytes: Uint8Array, filename: string, title: string): Promise<boolean | "cancelled"> {
  if (typeof navigator === "undefined" || !navigator.canShare) return false;
  const file = new File([bytes as BlobPart], filename, { type: "application/pdf" });
  if (!navigator.canShare({ files: [file] })) return false;
  try {
    await navigator.share({ files: [file], title });
    return true;
  } catch (e) {
    if ((e as Error)?.name === "AbortError") return "cancelled";
    return false;
  }
}

function viaDownload(bytes: Uint8Array, filename: string) {
  const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function savePdf(bytes: Uint8Array, filename: string, title: string, labels: PdfLabels = ENGLISH) {
  const cap = capacitor();
  if (cap?.isNativePlatform?.()) {
    // Older app builds do not include the file plugins: use a link instead.
    if (!cap.isPluginAvailable?.("Filesystem") || !cap.isPluginAvailable?.("Share")) return await viaLink(bytes, filename, labels);
    try {
      const { Filesystem, Directory } = await import("@capacitor/filesystem");
      const { Share } = await import("@capacitor/share");
      const written = await Filesystem.writeFile({ path: filename, data: toBase64(bytes), directory: Directory.Cache });
      await Share.share({ title, url: written.uri, dialogTitle: "Save or share your report" });
    } catch (e) {
      // Closing the share sheet is not an error; anything else falls back to a link.
      if (!/cancel/i.test(String((e as Error)?.message ?? e))) await viaLink(bytes, filename, labels);
    }
    return;
  }

  const standalone =
    (typeof window !== "undefined" && window.matchMedia?.("(display-mode: standalone)").matches) ||
    Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
  if (cannotDownloadHere(navigator.userAgent, standalone && /iPhone|iPad|iPod/i.test(navigator.userAgent))) {
    const shared = await viaShareSheet(bytes, filename, title);
    if (shared) return;
    return await viaLink(bytes, filename, labels);
  }
  viaDownload(bytes, filename);
}
