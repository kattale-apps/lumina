"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { LANGUAGES, TRANSLATED_LANGS, languageLabel, type Lang } from "../../../../convex/lib/languages";
import { BUNDLES } from "@/lib/i18n/bundles";
import { en, type MessageKey } from "@/lib/i18n/en";
import { CompanyPage, ConfiguredOnly, errorMessage } from "../workspace";

const PAGE = 25;
const KEYS = Object.keys(en) as MessageKey[];

function LanguageTabs({ lang, setLang, tenantId }: { lang: Lang; setLang: (l: Lang) => void; tenantId: Id<"tenants"> }) {
  const overview = useQuery(api.i18n.languageOverview, { tenantId });
  return (
    <nav className="customer-nav user-tabs" aria-label="Languages">
      {TRANSLATED_LANGS.map((code) => {
        const row = overview?.find((o) => o.lang === code);
        return (
          <button key={code} type="button" className={lang === code ? "customer-tab customer-tab-on" : "customer-tab"} aria-pressed={lang === code} onClick={() => setLang(code)}>
            {LANGUAGES.find((l) => l.code === code)!.english}
            <span className="user-tab-count">{row?.reviewed ? "✓ checked" : "draft"}</span>
          </button>
        );
      })}
    </nav>
  );
}

function ReviewSwitch({ tenantId, lang }: { tenantId: Id<"tenants">; lang: Lang }) {
  const data = useQuery(api.i18n.uiCorrections, { tenantId, lang });
  const setReviewed = useMutation(api.i18n.setReviewed);
  if (!data) return null;
  return (
    <div className={data.reviewed ? "translation-status translation-status-ok" : "translation-status"}>
      <p>
        {data.reviewed
          ? `${languageLabel(lang)} is marked as checked by a native speaker. Pages in it no longer say "Draft translation".`
          : `${languageLabel(lang)} is a draft. Pages in it say "Draft translation" until a native speaker has checked it.`}
      </p>
      <button type="button" className={data.reviewed ? "button button-secondary button-small" : "button button-small"} onClick={() => void setReviewed({ tenantId, lang, reviewed: !data.reviewed })}>
        {data.reviewed ? "Mark as draft again" : "Mark as checked"}
      </button>
    </div>
  );
}

function ScreenText({ tenantId, lang }: { tenantId: Id<"tenants">; lang: Lang }) {
  const data = useQuery(api.i18n.uiCorrections, { tenantId, lang });
  const save = useMutation(api.i18n.setUiText);
  const [search, setSearch] = useState("");
  const [onlyFixed, setOnlyFixed] = useState(false);
  const [page, setPage] = useState(0);
  const [editing, setEditing] = useState<{ key: MessageKey; text: string } | null>(null);
  const [error, setError] = useState("");
  const bundle = BUNDLES[lang] ?? {};
  const fixed = data?.entries ?? {};

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return KEYS.filter((k) => {
      if (onlyFixed && !(k in fixed)) return false;
      if (!q) return true;
      return `${k} ${en[k]} ${fixed[k] ?? bundle[k] ?? ""}`.toLowerCase().includes(q);
    });
  }, [search, onlyFixed, fixed, bundle]);
  useEffect(() => setPage(0), [search, onlyFixed, lang]);

  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const shown = rows.slice(page * PAGE, page * PAGE + PAGE);

  async function store(key: MessageKey, text: string) {
    setError("");
    try {
      await save({ tenantId, lang, key, text });
      setEditing(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <section className="workspace-section">
      <h2>Screen text</h2>
      <p className="hint">
        English is the source. Keep anything in {"{curly brackets}"}, **double stars** and [square brackets]: they are filled in, made
        bold or turned into links. Saving a correction takes effect for everyone at once.
      </p>
      <input className="user-search" type="search" placeholder="Search English or translation" value={search} onChange={(e) => setSearch(e.target.value)} />
      <label className="check-row">
        <input type="checkbox" checked={onlyFixed} onChange={(e) => setOnlyFixed(e.target.checked)} /> Only show corrected text ({Object.keys(fixed).length})
      </label>
      {error ? <p className="auth-message" role="alert">{error}</p> : null}
      <ul className="translation-list">
        {shown.map((key) => {
          const current = fixed[key] ?? bundle[key];
          const isEditing = editing?.key === key;
          return (
            <li key={key} className="translation-row">
              <span className="translation-key">{key}{key in fixed ? <span className="pill pill-ok">corrected</span> : current ? null : <span className="pill pill-warn">missing: English shows</span>}</span>
              <p className="translation-en">{en[key]}</p>
              {isEditing ? (
                <>
                  <textarea rows={Math.min(8, Math.max(2, Math.ceil(editing.text.length / 60)))} value={editing.text} onChange={(e) => setEditing({ key, text: e.target.value })} />
                  <div className="response-actions">
                    <button type="button" className="button button-small" onClick={() => store(key, editing.text)}>Save correction</button>
                    <button type="button" className="button button-small button-secondary" onClick={() => setEditing(null)}>Cancel</button>
                    {key in fixed ? (
                      <button type="button" className="link-danger" onClick={() => store(key, "")}>Go back to the draft</button>
                    ) : null}
                  </div>
                </>
              ) : (
                <button type="button" className="translation-current" onClick={() => setEditing({ key, text: current ?? "" })}>
                  {current ?? <em>Not translated yet: tap to add</em>}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {pages > 1 ? (
        <nav className="pager" aria-label="Pages">
          <button type="button" className="button button-secondary button-small" disabled={page === 0} onClick={() => setPage(page - 1)}>‹ Previous</button>
          <span>{page * PAGE + 1}–{Math.min(rows.length, (page + 1) * PAGE)} of {rows.length}</span>
          <button type="button" className="button button-secondary button-small" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>Next ›</button>
        </nav>
      ) : null}
    </section>
  );
}

type Draft = {
  title: string;
  summary: string;
  lessons: { key: string; title: string; body: string }[];
  questions: { key: string; prompt: string; options: string[]; explanation: string }[];
};

function AcademyText({ tenantId, lang }: { tenantId: Id<"tenants">; lang: Lang }) {
  const [moduleKey, setModuleKey] = useState("m1");
  const data = useQuery(api.i18n.academyForEdit, { tenantId, lang, moduleKey });
  const save = useMutation(api.i18n.saveAcademyTranslation);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  // Start from what learners see now, filling gaps from the English.
  useEffect(() => {
    if (!data) return;
    const tr = data.translation;
    setDraft({
      title: tr?.title ?? data.english.title,
      summary: tr?.summary ?? data.english.summary,
      lessons: data.english.lessons.map((l) => {
        const t = tr?.lessons.find((x) => x.key === l.key);
        return { key: l.key, title: t?.title ?? l.title, body: t?.body ?? l.body };
      }),
      questions: data.english.questions.map((q) => {
        const t = tr?.questions.find((x) => x.key === q.key);
        const options = t && t.options.length === q.options.length ? t.options : q.options;
        return { key: q.key, prompt: t?.prompt ?? q.prompt, options, explanation: t?.explanation ?? q.explanation };
      })
    });
    setNotice(null);
  }, [data]);

  if (!data || !draft) return <p className="muted">Loading the module…</p>;

  async function store() {
    if (!draft) return;
    setBusy(true);
    setNotice(null);
    try {
      await save({ tenantId, lang, moduleKey, ...draft, questions: draft.questions.map((q) => ({ ...q, explanation: q.explanation || undefined })) });
      setNotice({ ok: true, text: "Saved. Learners see this version now." });
    } catch (e) {
      setNotice({ ok: false, text: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  }

  const sourceText = {
    saved: "Learners see the version saved here.",
    draft: "Learners see the shipped draft. Saving here replaces it.",
    stale: "The English module was edited after this translation was saved, so learners see English. Update the translation and save it.",
    none: "There is no translation yet, so learners see English. The fields below start from the English."
  }[data.source];

  return (
    <section className="workspace-section">
      <h2>Sales Academy</h2>
      <nav className="customer-nav user-tabs" aria-label="Modules">
        {data.modules.map((k, i) => (
          <button key={k} type="button" className={moduleKey === k ? "customer-tab customer-tab-on" : "customer-tab"} onClick={() => setModuleKey(k)}>
            Module {i + 1}
          </button>
        ))}
      </nav>
      <p className={data.source === "stale" ? "next-step-inline" : "hint"}>{sourceText}</p>
      <div className="panel-form translation-module">
        <label>Title <small className="translation-en">{data.english.title}</small></label>
        <input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
        <label>Summary <small className="translation-en">{data.english.summary}</small></label>
        <textarea rows={2} value={draft.summary} onChange={(e) => setDraft({ ...draft, summary: e.target.value })} />
        {draft.lessons.map((l, i) => (
          <fieldset key={l.key} className="response-option">
            <legend>Lesson {i + 1}</legend>
            <label>Title <small className="translation-en">{data.english.lessons[i].title}</small></label>
            <input value={l.title} onChange={(e) => setDraft({ ...draft, lessons: draft.lessons.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)) })} />
            <details>
              <summary>English text</summary>
              <pre className="translation-source">{data.english.lessons[i].body}</pre>
            </details>
            <textarea rows={10} value={l.body} onChange={(e) => setDraft({ ...draft, lessons: draft.lessons.map((x, j) => (j === i ? { ...x, body: e.target.value } : x)) })} />
          </fieldset>
        ))}
        {draft.questions.map((q, i) => (
          <fieldset key={q.key} className="response-option">
            <legend>Question {i + 1}</legend>
            <small className="translation-en">{data.english.questions[i].prompt}</small>
            <textarea rows={2} value={q.prompt} onChange={(e) => setDraft({ ...draft, questions: draft.questions.map((x, j) => (j === i ? { ...x, prompt: e.target.value } : x)) })} />
            {q.options.map((o, oi) => (
              <div key={oi} className="translation-option">
                <small className="translation-en">{oi + 1}. {data.english.questions[i].options[oi]}</small>
                <input value={o} onChange={(e) => setDraft({ ...draft, questions: draft.questions.map((x, j) => (j === i ? { ...x, options: x.options.map((y, k) => (k === oi ? e.target.value : y)) } : x)) })} />
              </div>
            ))}
            <small className="translation-en">Explanation: {data.english.questions[i].explanation}</small>
            <textarea rows={2} value={q.explanation} onChange={(e) => setDraft({ ...draft, questions: draft.questions.map((x, j) => (j === i ? { ...x, explanation: e.target.value } : x)) })} />
          </fieldset>
        ))}
        {notice ? <p className={notice.ok ? "form-success" : "auth-message"} role="status">{notice.text}</p> : null}
        <button type="button" className="button" disabled={busy} onClick={store}>{busy ? "Saving…" : "Save this module"}</button>
        <p className="hint">Answer choices stay in the same order as the English, so the quiz is still marked correctly.</p>
      </div>
    </section>
  );
}

function Translations({ tenantId }: { tenantId: Id<"tenants"> }) {
  const [lang, setLang] = useState<Lang>("lg");
  const [area, setArea] = useState<"screen" | "academy">("screen");
  return (
    <>
      <p className="hint">
        Draft translations of the public pages and the Sales Academy. Ask a native speaker to read through each language and correct it
        here, then mark it as checked.
      </p>
      <LanguageTabs lang={lang} setLang={setLang} tenantId={tenantId} />
      <ReviewSwitch tenantId={tenantId} lang={lang} />
      <div className="segmented" role="tablist" aria-label="What to edit">
        <button type="button" role="tab" aria-selected={area === "screen"} className={area === "screen" ? "segmented-on" : ""} onClick={() => setArea("screen")}>Screen text</button>
        <button type="button" role="tab" aria-selected={area === "academy"} className={area === "academy" ? "segmented-on" : ""} onClick={() => setArea("academy")}>Sales Academy</button>
      </div>
      {area === "screen" ? <ScreenText key={lang} tenantId={tenantId} lang={lang} /> : <AcademyText key={lang} tenantId={tenantId} lang={lang} />}
    </>
  );
}

export default function TranslationsPage() {
  return (
    <ConfiguredOnly>
      <CompanyPage title="Translations" allowedRoles={["super_admin"]}>
        {(company) => <Translations tenantId={company.tenantId} />}
      </CompanyPage>
    </ConfiguredOnly>
  );
}
