"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { CompanyPage, ConfiguredOnly, errorMessage } from "../../workspace";
import { LessonBody, LessonVideo } from "../content";
import { DraftNotice, LanguagePicker, Rich, useLanguage } from "@/lib/i18n";

type Module = FunctionReturnType<typeof api.academy.getModule>;
type Result = FunctionReturnType<typeof api.academy.submitQuiz>;

/** Answers are shown in a fresh order each attempt, so positions cannot be memorised. */
function shuffled<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function Quiz({ tenantId, module: m }: { tenantId: Id<"tenants">; module: Module }) {
  const { t, lang } = useLanguage();
  const submit = useMutation(api.academy.submitQuiz);
  const [attempt, setAttempt] = useState(0);
  const [chosen, setChosen] = useState<Record<string, number>>({});
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Each option keeps its original index, which is what the server marks.
  const order = useMemo(
    () => Object.fromEntries(m.questions.map((q) => [q.key, shuffled(q.options.map((text, index) => ({ text, index })))])),
    // A new attempt or an edited module gets a new order.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [m.key, m.version, attempt, lang, m.translated]
  );
  const answered = m.questions.filter((q) => chosen[q.key] !== undefined).length;

  async function send(event: FormEvent) {
    event.preventDefault();
    if (answered < m.questions.length) {
      setError(t("academy.answerAll", { left: m.questions.length - answered }));
      return;
    }
    setBusy(true);
    setError("");
    try {
      const marked = await submit({
        tenantId,
        key: m.key,
        version: m.version,
        answers: m.questions.map((q) => ({ questionKey: q.key, optionIndex: chosen[q.key] })),
        lang
      });
      setResult(marked);
      setTimeout(() => document.getElementById("quiz-result")?.scrollIntoView({ behavior: "smooth" }), 50);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  function retry() {
    setResult(null);
    setChosen({});
    setError("");
    setAttempt((n) => n + 1);
    setTimeout(() => document.getElementById("quiz")?.scrollIntoView({ behavior: "smooth" }), 50);
  }

  const outcome = (key: string) => result?.results.find((r) => r.questionKey === key);

  return (
    <form id="quiz" className="panel-form quiz" onSubmit={send}>
      <h2>{t("academy.quizTitle", { number: m.number })}</h2>
      <p className="hint">
        {t("academy.quizHint", { count: m.questions.length, pass: m.passPercent })}
        {m.passed ? ` ${t("academy.alreadyPassed")}` : ""}
      </p>

      {m.questions.map((q, i) => {
        const r = outcome(q.key);
        return (
          <fieldset key={q.key} className={r ? (r.correct ? "quiz-question quiz-right" : "quiz-question quiz-wrong") : "quiz-question"} disabled={Boolean(result)}>
            <legend>
              <span className="step-num">{i + 1}</span> {q.prompt}
            </legend>
            {order[q.key].map((o) => (
              <label key={o.index} className={chosen[q.key] === o.index ? "quiz-option quiz-option-on" : "quiz-option"}>
                <input
                  type="radio"
                  name={q.key}
                  checked={chosen[q.key] === o.index}
                  onChange={() => setChosen((c) => ({ ...c, [q.key]: o.index }))}
                />
                <span>{o.text}</span>
                {r && r.correctIndex === o.index ? <span className="pill pill-ok">{t("academy.correctAnswer")}</span> : null}
              </label>
            ))}
            {r ? (
              <p className={r.correct ? "form-success" : "auth-message"} role="status">
                {r.correct ? t("academy.correct") : t("academy.notCorrect")}
                {r.explanation ? ` ${r.explanation}` : ""}
              </p>
            ) : null}
          </fieldset>
        );
      })}

      {error ? <p className="auth-message" role="alert">{error}</p> : null}

      {result ? (
        <div id="quiz-result" className={result.passed ? "quiz-result quiz-result-pass" : "quiz-result"} aria-live="polite">
          <h3>{result.passed ? t("academy.youPassed") : t("academy.notPassed")}</h3>
          <p>
            <Rich text={t("academy.score", { correct: result.correct, total: result.total, percent: result.scorePercent, pass: result.passPercent })} />
          </p>
          {!result.passed ? (
            <p className="hint">{t("academy.missed")}</p>
          ) : null}
          {result.certificateNumber ? (
            <p>
              <Rich text={t("academy.courseDone", { number: result.certificateNumber })} />
            </p>
          ) : null}
          <div className="response-actions">
            {!result.passed ? <button type="button" className="button" onClick={retry}>{t("academy.tryAgain")}</button> : null}
            {result.passed && m.nextKey && !result.certificateNumber ? (
              <Link className="button" href={`/dashboard/academy/${m.nextKey}`}>{t("academy.nextModule")}</Link>
            ) : null}
            <Link className={result.certificateNumber ? "button" : "button button-secondary"} href="/dashboard/academy">
              {result.certificateNumber ? t("academy.getCertificate") : t("academy.backToAcademy")}
            </Link>
            {result.passed ? <button type="button" className="button button-secondary" onClick={retry}>{t("academy.takeAgain")}</button> : null}
          </div>
        </div>
      ) : (
        <button className="button" type="submit" disabled={busy}>
          {busy ? t("academy.marking") : t("academy.submit", { answered, count: m.questions.length })}
        </button>
      )}
    </form>
  );
}

function ModuleView({ tenantId }: { tenantId: Id<"tenants"> }) {
  const { t, lang } = useLanguage();
  const params = useParams<{ key: string }>();
  const known = ["m1", "m2", "m3", "m4"].includes(params.key);
  const m = useQuery(api.academy.getModule, known ? { tenantId, key: params.key, lang } : "skip");

  if (!known) {
    return (
      <>
        <p className="muted">{t("academy.noModule")}</p>
        <Link className="button button-secondary" href="/dashboard/academy">{t("academy.backToAcademy")}</Link>
      </>
    );
  }
  if (!m) return <p className="muted">{t("academy.loadingModule")}</p>;

  return (
    <article className="academy-module">
      <div className="academy-module-top">
        <Link className="back-link" href="/dashboard/academy">← {m.academyName}</Link>
        <LanguagePicker />
      </div>
      <DraftNotice />
      {lang !== "en" && !m.translated ? <p className="next-step-inline">{t("academy.notTranslated")}</p> : null}
      <p className="eyebrow">{t("academy.moduleOf", { number: m.number })}</p>
      <h2 className="academy-module-title">{m.title}</h2>
      <p className="muted">{m.summary}</p>
      <p className="pill-row">
        {m.passed ? <span className="pill pill-ok">{t("academy.passed", { percent: m.bestPercent ?? 0 })}</span> : null}
        <span className="pill pill-info">{t("academy.lessons", { count: m.lessons.length })}</span>
        <a className="pill pill-info" href="#quiz">{t("academy.goToQuiz")}</a>
      </p>

      {m.lessons.map((l, i) => (
        <section key={l.key} className="lesson" aria-labelledby={`lesson-${l.key}`}>
          <h3 id={`lesson-${l.key}`}><span className="step-num">{i + 1}</span> {l.title}</h3>
          {l.videoUrl ? <LessonVideo url={l.videoUrl} title={l.title} /> : null}
          <LessonBody text={l.body} />
        </section>
      ))}

      <Quiz key={`${m.key}-${m.version}`} tenantId={tenantId} module={m} />
    </article>
  );
}

export default function AcademyModulePage() {
  return (
    <ConfiguredOnly>
      <CompanyPage title="Sales Academy">
        {(company) => <ModuleView tenantId={company.tenantId} />}
      </CompanyPage>
    </ConfiguredOnly>
  );
}
