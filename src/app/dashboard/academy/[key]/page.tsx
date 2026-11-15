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
    [m.key, m.version, attempt]
  );
  const answered = m.questions.filter((q) => chosen[q.key] !== undefined).length;

  async function send(event: FormEvent) {
    event.preventDefault();
    if (answered < m.questions.length) {
      setError(`Answer every question first: ${m.questions.length - answered} to go.`);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const marked = await submit({
        tenantId,
        key: m.key,
        version: m.version,
        answers: m.questions.map((q) => ({ questionKey: q.key, optionIndex: chosen[q.key] }))
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
      <h2>Module {m.number} quiz</h2>
      <p className="hint">
        {m.questions.length} questions. You need {m.passPercent}% to pass, and you can try again if you do not.
        {m.passed ? " You have already passed this module; another attempt will not change that." : ""}
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
                {r && r.correctIndex === o.index ? <span className="pill pill-ok">Correct answer</span> : null}
              </label>
            ))}
            {r ? (
              <p className={r.correct ? "form-success" : "auth-message"} role="status">
                {r.correct ? "✓ Correct." : "✗ Not correct."}
                {r.explanation ? ` ${r.explanation}` : ""}
              </p>
            ) : null}
          </fieldset>
        );
      })}

      {error ? <p className="auth-message" role="alert">{error}</p> : null}

      {result ? (
        <div id="quiz-result" className={result.passed ? "quiz-result quiz-result-pass" : "quiz-result"} aria-live="polite">
          <h3>{result.passed ? "🎉 You passed" : "Not passed yet"}</h3>
          <p>
            You answered <strong>{result.correct} of {result.total}</strong> correctly ({result.scorePercent}%).
            The pass mark is {result.passPercent}%.
          </p>
          {!result.passed ? (
            <p className="hint">The questions you missed are marked above. Read those lessons again, then try once more.</p>
          ) : null}
          {result.certificateNumber ? (
            <p>
              <strong>You have completed the whole course.</strong> Your certificate, no. {result.certificateNumber},
              is ready on the Academy page.
            </p>
          ) : null}
          <div className="response-actions">
            {!result.passed ? <button type="button" className="button" onClick={retry}>Try again</button> : null}
            {result.passed && m.nextKey && !result.certificateNumber ? (
              <Link className="button" href={`/dashboard/academy/${m.nextKey}`}>Next module</Link>
            ) : null}
            <Link className={result.certificateNumber ? "button" : "button button-secondary"} href="/dashboard/academy">
              {result.certificateNumber ? "Get my certificate" : "Back to the Academy"}
            </Link>
            {result.passed ? <button type="button" className="button button-secondary" onClick={retry}>Take it again</button> : null}
          </div>
        </div>
      ) : (
        <button className="button" type="submit" disabled={busy}>
          {busy ? "Marking…" : `Submit my answers (${answered} of ${m.questions.length} answered)`}
        </button>
      )}
    </form>
  );
}

function ModuleView({ tenantId }: { tenantId: Id<"tenants"> }) {
  const params = useParams<{ key: string }>();
  const known = ["m1", "m2", "m3", "m4"].includes(params.key);
  const m = useQuery(api.academy.getModule, known ? { tenantId, key: params.key } : "skip");

  if (!known) {
    return (
      <>
        <p className="muted">That module does not exist.</p>
        <Link className="button button-secondary" href="/dashboard/academy">Back to the Academy</Link>
      </>
    );
  }
  if (!m) return <p className="muted">Loading the module…</p>;

  return (
    <article className="academy-module">
      <p><Link className="back-link" href="/dashboard/academy">← {m.academyName}</Link></p>
      <p className="eyebrow">MODULE {m.number} OF 4</p>
      <h2 className="academy-module-title">{m.title}</h2>
      <p className="muted">{m.summary}</p>
      <p className="pill-row">
        {m.passed ? <span className="pill pill-ok">Passed · {m.bestPercent}%</span> : null}
        <span className="pill pill-info">{m.lessons.length} lessons</span>
        <a className="pill pill-info" href="#quiz">Go to the quiz ↓</a>
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
