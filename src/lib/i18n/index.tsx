"use client";

/**
 * Language support for the public pages and the Sales Academy.
 *
 * English text lives in ./en.ts, keyed. Each other language has a file of drafts with the same
 * keys (missing keys fall back to English). A super administrator's corrections are stored in
 * the database and win over the bundled drafts. Until a language is marked reviewed, pages in
 * it carry a "Draft translation" notice.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { LANGUAGES, isLang, languageLabel, type Lang } from "../../../convex/lib/languages";
import { en, type MessageKey } from "./en";
import { BUNDLES } from "./bundles";

export type { Lang, MessageKey };
type Vars = Record<string, string | number>;
type T = (key: MessageKey, vars?: Vars) => string;

const STORAGE_KEY = "solar-switch-language";

type LanguageState = { lang: Lang; setLang: (lang: Lang) => void; t: T; reviewed: boolean };

function interpolate(text: string, vars?: Vars) {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? String(vars[name]) : whole));
}

const englishT: T = (key, vars) => interpolate(en[key] ?? key, vars);
/** The translate function's shape, for helpers that are not components. */
export type Translate = T;
/** English, for helpers called without a component's language (and for documents that stay English). */
export const translateEnglish: T = englishT;
const Context = createContext<LanguageState>({ lang: "en", setLang: () => undefined, t: englishT, reviewed: true });

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>("en");
  const { isAuthenticated } = useConvexAuth();
  const me = useQuery(api.profile.myProfile, isAuthenticated ? {} : "skip");
  const saveLanguage = useMutation(api.profile.setLanguage);
  const overrides = useQuery(api.i18n.publicOverrides, lang === "en" ? "skip" : { lang });

  // The phone remembers the choice; a signed-in person's profile choice wins on any device.
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (isLang(stored)) setLangState(stored);
    } catch {
      // Storage blocked: English until chosen.
    }
  }, []);
  useEffect(() => {
    if (me?.language && isLang(me.language)) setLangState(me.language);
  }, [me?.language]);
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const setLang = useCallback(
    (next: Lang) => {
      setLangState(next);
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch {
        // Not remembered on this phone.
      }
      if (isAuthenticated) void saveLanguage({ language: next }).catch(() => undefined);
    },
    [isAuthenticated, saveLanguage]
  );

  const value = useMemo<LanguageState>(() => {
    if (lang === "en") return { lang, setLang, t: englishT, reviewed: true };
    const bundle = BUNDLES[lang] ?? {};
    const fixed = overrides?.entries ?? {};
    const t: T = (key, vars) => interpolate(fixed[key] ?? bundle[key] ?? en[key] ?? key, vars);
    return { lang, setLang, t, reviewed: overrides?.reviewed ?? false };
  }, [lang, setLang, overrides]);

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useLanguage() {
  return useContext(Context);
}

export function useT() {
  return useContext(Context).t;
}

/**
 * Renders translated text in which **these words** are bold and [these words] are a link,
 * so translators can move the emphasis and the link to wherever their grammar puts them.
 */
export function Rich({ text, link }: { text: string; link?: (label: string) => ReactNode }) {
  const parts = text.split(/(\*\*.+?\*\*|\[.+?\])/g);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith("**") && part.endsWith("**")) return <strong key={i}>{part.slice(2, -2)}</strong>;
        if (part.startsWith("[") && part.endsWith("]")) return <span key={i}>{link ? link(part.slice(1, -1)) : part.slice(1, -1)}</span>;
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}

/**
 * A compact language chooser for crowded phone headers: a globe and a short code (EN, LG…).
 * The real list (full language names) is a native select laid invisibly over it.
 */
export function LanguagePicker({ className = "" }: { className?: string }) {
  const { lang, setLang, t } = useLanguage();
  return (
    <label className={`language-picker ${className}`} title={languageLabel(lang)}>
      <span aria-hidden="true">🌐</span>
      <span className="language-code" aria-hidden="true">{lang.toUpperCase()}</span>
      <span className="visually-hidden">{t("lang.choose")}</span>
      <select value={lang} onChange={(e) => isLang(e.target.value) && setLang(e.target.value)}>
        {LANGUAGES.map((l) => (
          <option key={l.code} value={l.code}>
            {languageLabel(l.code)}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Shown under the header while the chosen language is still a draft. */
export function DraftNotice() {
  const { lang, reviewed, t } = useLanguage();
  if (lang === "en" || reviewed) return null;
  return (
    <p className="draft-notice" role="note">
      <span aria-hidden="true">🌐</span> {t("lang.draft")}
    </p>
  );
}
