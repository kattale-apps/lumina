/**
 * Languages the public pages and the Sales Academy can be shown in. English is the source;
 * every other language is a translation that may be incomplete, in which case English shows
 * for the missing text. Codes are ISO 639 (two letters where one exists, else three).
 */
export const LANGUAGES = [
  { code: "en", name: "English", english: "English" },
  { code: "lg", name: "Luganda", english: "Luganda" },
  { code: "nyn", name: "Runyankore", english: "Runyankole" },
  { code: "sw", name: "Kiswahili", english: "Swahili" },
  { code: "ach", name: "Leb Acoli", english: "Acholi" },
  { code: "xog", name: "Lusoga", english: "Lusoga" },
  { code: "teo", name: "Ateso", english: "Ateso" }
] as const;

export type Lang = (typeof LANGUAGES)[number]["code"];
export const LANG_CODES = LANGUAGES.map((l) => l.code) as Lang[];
export const TRANSLATED_LANGS = LANG_CODES.filter((c) => c !== "en");

export function isLang(value: unknown): value is Lang {
  return typeof value === "string" && (LANG_CODES as string[]).includes(value);
}

/** "Luganda" or "Runyankore (Runyankole)": the language's own name, with the English one when it differs. */
export function languageLabel(code: Lang) {
  const l = LANGUAGES.find((x) => x.code === code)!;
  return l.name === l.english ? l.name : `${l.name} (${l.english})`;
}
