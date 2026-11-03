/**
 * Saves a generated PDF for the user.
 *
 * In a browser: a normal download. In the Android app, the WebView ignores
 * download links, so the file is written to the app's cache and handed to the
 * Android share sheet, where the user can save it to Files, open it, or send
 * it on WhatsApp or email.
 */

type CapacitorGlobal = {
  isNativePlatform?: () => boolean;
  isPluginAvailable?: (name: string) => boolean;
};

function capacitor(): CapacitorGlobal | undefined {
  return (globalThis as { Capacitor?: CapacitorGlobal }).Capacitor;
}

export function isNativeApp() {
  return Boolean(capacitor()?.isNativePlatform?.());
}

function toBase64(bytes: Uint8Array) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export class AppUpdateNeeded extends Error {
  constructor() {
    super("Update the Solar Switch app to save PDF reports.");
  }
}

export async function savePdf(bytes: Uint8Array, filename: string, title: string) {
  const cap = capacitor();
  if (cap?.isNativePlatform?.()) {
    // Older app builds do not include the file plugins.
    if (!cap.isPluginAvailable?.("Filesystem") || !cap.isPluginAvailable?.("Share")) throw new AppUpdateNeeded();
    const { Filesystem, Directory } = await import("@capacitor/filesystem");
    const { Share } = await import("@capacitor/share");
    const written = await Filesystem.writeFile({ path: filename, data: toBase64(bytes), directory: Directory.Cache });
    try {
      await Share.share({ title, url: written.uri, dialogTitle: "Save or share your report" });
    } catch (e) {
      // Closing the share sheet is not an error.
      if (!/cancel/i.test(String((e as Error)?.message ?? e))) throw e;
    }
    return;
  }

  const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
