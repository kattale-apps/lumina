import { isNativeApp, savePdf } from "./savePdf";
import { whatsappLink } from "./whatsapp";

export type ShareOutcome = "shared" | "cancelled" | "downloaded";

/**
 * Hands a PDF to WhatsApp as well as the device allows:
 * - in the Android app and on phones, the share sheet opens with the PDF attached (pick WhatsApp);
 * - elsewhere (a laptop), the PDF downloads and WhatsApp opens to the customer's chat, ready for
 *   the file to be attached.
 */
export async function sharePdf(
  bytes: Uint8Array,
  filename: string,
  title: string,
  whatsapp: { to: string | null; text: string }
): Promise<ShareOutcome> {
  if (isNativeApp()) {
    await savePdf(bytes, filename, title);
    return "shared";
  }
  const file = new File([bytes as BlobPart], filename, { type: "application/pdf" });
  if (typeof navigator !== "undefined" && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title, text: whatsapp.text });
      return "shared";
    } catch (e) {
      if ((e as Error)?.name === "AbortError") return "cancelled";
      // Some browsers refuse at the last moment; fall through to download.
    }
  }
  await savePdf(bytes, filename, title);
  if (whatsapp.to) window.open(whatsappLink(whatsapp.to, whatsapp.text), "_blank", "noopener");
  return "downloaded";
}
