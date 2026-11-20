/**
 * WhatsApp "click to chat" links (https://wa.me/<number>?text=...). They need the number in
 * international form, digits only: "+256 700 123456" and "0700 123456" both become "256700123456".
 * A number starting with 0 is taken as Ugandan.
 */
export function whatsappDigits(raw: string | null | undefined, countryCode = "256"): string | null {
  if (!raw) return null;
  let digits = raw.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) digits = digits.slice(1);
  else if (digits.startsWith("00")) digits = digits.slice(2);
  else if (digits.startsWith("0")) digits = countryCode + digits.slice(1);
  digits = digits.replace(/\D/g, "");
  return /^[1-9]\d{7,14}$/.test(digits) ? digits : null;
}

/** A link that opens WhatsApp to this number with the message typed in, ready to send. */
export function whatsappLink(number: string, text: string) {
  return `https://wa.me/${number}?text=${encodeURIComponent(text)}`;
}
