"use client";

import { whatsappLink } from "@/lib/whatsapp";
import { useT } from "@/lib/i18n";

/**
 * After a request is saved: one tap opens WhatsApp to the company's number with the request typed
 * in, so the customer only presses send. A plain link, so it works in every browser and in the app.
 */
export function WhatsAppSend({ number, text }: { number: string; text: string }) {
  const t = useT();
  return (
    <div className="next-step whatsapp-send">
      <strong>{t("whatsapp.title")}</strong>
      <p>{t("whatsapp.text")}</p>
      <a className="button button-whatsapp guide-glow" href={whatsappLink(number, text)} target="_blank" rel="noopener noreferrer">
        <span aria-hidden="true">💬</span> {t("whatsapp.button")}
      </a>
    </div>
  );
}

/** "Reference" shown in the message and on the request, so staff can match the two. */
export function requestReference(id: string) {
  return id.slice(-6).toUpperCase();
}
