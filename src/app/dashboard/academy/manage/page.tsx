"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { CompanyPage, ConfiguredOnly, errorMessage } from "../../workspace";
import { LessonBody, LessonVideo } from "../content";

type Loaded = FunctionReturnType<typeof api.academy.getModuleForEdit>;
type Lesson = Loaded["lessons"][number];
type Question = Loaded["questions"][number];

const MODULES = ["m1", "m2", "m3", "m4"] as const;
const newKey = (prefix: string) => `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

function move<T>(items: T[], from: number, by: number): T[] {
  const to = from + by;
  if (to < 0 || to >= items.length) return items;
  const out = [...items];
  [out[from], out[to]] = [out[to], out[from]];
  return out;
}

function LessonEditor({
  lesson, index, count, onChange, onMove, onRemove
}: {
  lesson: Lesson;
  index: number;
  count: number;
  onChange: (patch: Partial<Lesson>) => void;
  onMove: (by: number) => void;
  onRemove: () => void;
}) {
  const [preview, setPreview] = useState(false);
  const id = `lesson-${lesson.key}`;
  return (
    <fieldset className="editor-block">
      <legend>Lesson {index + 1}</legend>
      <label htmlFor={`${id}-title`}>Title</label>
      <input id={`${id}-title`} maxLength={120} value={lesson.title} onChange={(e) => onChange({ title: e.target.value })} />
      <label htmlFor={`${id}-video`}>Video link (optional)</label>
      <input
        id={`${id}-video`}
        type="url"
        inputMode="url"
        maxLength={300}
        placeholder="https://www.youtube.com/watch?v=…"
        value={lesson.videoUrl}
        onChange={(e) => onChange({ videoUrl: e.target.value })}
      />
      <label htmlFor={`${id}-body`}>Text</label>
      <textarea id={`${id}-body`} rows={12} maxLength={8000} value={lesson.body} onChange={(e) => onChange({ body: e.target.value })} />
      <p className="hint">
        Leave an empty line between paragraphs. Start a line with <code>## </code> for a sub-heading and with <code>- </code> for a bullet point.
        {" "}{lesson.body.length.toLocaleString("en-US")} of 8,000 characters.
      </p>
      <div className="editor-actions">
        <button type="button" className="link-button" onClick={() => setPreview((p) => !p)}>{preview ? "Hide preview" : "Preview"}</button>
        <button type="button" className="link-button" disabled={index === 0} onClick={() => onMove(-1)}>Move up</button>
        <button type="button" className="link-button" disabled={index === count - 1} onClick={() => onMove(1)}>Move down</button>
        <button type="button" className="link-button link-danger" disabled={count === 1} onClick={onRemove}>Remove lesson</button>
      </div>
      {preview ? (
        <div className="lesson editor-preview">
          <h3>{lesson.title || "Untitled lesson"}</h3>
          {lesson.videoUrl.trim() ? <LessonVideo url={lesson.videoUrl.trim()} title={lesson.title} /> : null}
          <LessonBody text={lesson.body} />
        </div>
      ) : null}
    </fieldset>
  );
}

function QuestionEditor({
  question, index, count, onChange, onMove, onRemove
}: {
  question: Question;
  index: number;
  count: number;
  onChange: (patch: Partial<Question>) => void;
  onMove: (by: number) => void;
  onRemove: () => void;
}) {
  const id = `question-${question.key}`;
  const setOption = (i: number, text: string) => onChange({ options: question.options.map((o, j) => (j === i ? text : o)) });
  function removeOption(i: number) {
    const options = question.options.filter((_, j) => j !== i);
    // Keep the same answer marked correct where possible.
    const correctIndex = question.correctIndex === i ? 0 : question.correctIndex > i ? question.correctIndex - 1 : question.correctIndex;
    onChange({ options, correctIndex });
  }
  return (
    <fieldset className="editor-block">
      <legend>Question {index + 1}</legend>
      <label htmlFor={`${id}-prompt`}>Question</label>
      <textarea id={`${id}-prompt`} rows={2} maxLength={400} value={question.prompt} onChange={(e) => onChange({ prompt: e.target.value })} />
      <p className="field-label">Answers: select the correct one</p>
      {question.options.map((option, i) => (
        <div key={i} className="editor-option">
          <input
            type="radio"
            name={`${id}-correct`}
            aria-label={`Answer ${i + 1} is correct`}
            checked={question.correctIndex === i}
            onChange={() => onChange({ correctIndex: i })}
          />
          <input aria-label={`Answer ${i + 1}`} maxLength={200} value={option} onChange={(e) => setOption(i, e.target.value)} />
          <button type="button" className="link-button link-danger" disabled={question.options.length <= 2} onClick={() => removeOption(i)} aria-label={`Remove answer ${i + 1}`}>
            Remove
          </button>
        </div>
      ))}
      {question.options.length < 6 ? (
        <button type="button" className="link-button" onClick={() => onChange({ options: [...question.options, ""] })}>+ Add an answer</button>
      ) : null}
      <label htmlFor={`${id}-why`}>Explanation shown after passing (optional)</label>
      <input id={`${id}-why`} maxLength={500} value={question.explanation} onChange={(e) => onChange({ explanation: e.target.value })} />
      <div className="editor-actions">
        <button type="button" className="link-button" disabled={index === 0} onClick={() => onMove(-1)}>Move up</button>
        <button type="button" className="link-button" disabled={index === count - 1} onClick={() => onMove(1)}>Move down</button>
        <button type="button" className="link-button link-danger" disabled={count <= 3} onClick={onRemove}>Remove question</button>
      </div>
    </fieldset>
  );
}

const snapshotOf = (m: { title: string; summary: string; passPercent: string; lessons: Lesson[]; questions: Question[] }) =>
  JSON.stringify([m.title, m.summary, m.passPercent, m.lessons, m.questions]);

function ModuleEditor({
  tenantId, loaded, onDirty
}: {
  tenantId: Id<"tenants">;
  loaded: Loaded;
  onDirty: (dirty: boolean) => void;
}) {
  const save = useMutation(api.academy.saveModule);
  const restore = useMutation(api.academy.restoreModule);
  const [title, setTitle] = useState(loaded.title);
  const [summary, setSummary] = useState(loaded.summary);
  const [passPercent, setPassPercent] = useState(String(loaded.passPercent));
  const [lessons, setLessons] = useState<Lesson[]>(loaded.lessons);
  const [questions, setQuestions] = useState<Question[]>(loaded.questions);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  // The version this form was last in step with. A save on top of someone else's newer edit is refused.
  const [baseVersion, setBaseVersion] = useState(loaded.version);
  const [saved, setSaved] = useState(() =>
    snapshotOf({ title: loaded.title, summary: loaded.summary, passPercent: String(loaded.passPercent), lessons: loaded.lessons, questions: loaded.questions })
  );
  const dirty = snapshotOf({ title, summary, passPercent, lessons, questions }) !== saved;
  useEffect(() => onDirty(dirty), [dirty, onDirty]);

  // When the module goes back to the original text, show that text.
  const wasEdited = useRef(loaded.edited);
  useEffect(() => {
    if (wasEdited.current && !loaded.edited) {
      setTitle(loaded.title);
      setSummary(loaded.summary);
      setPassPercent(String(loaded.passPercent));
      setLessons(loaded.lessons);
      setQuestions(loaded.questions);
      setBaseVersion(loaded.version);
      setSaved(snapshotOf({ title: loaded.title, summary: loaded.summary, passPercent: String(loaded.passPercent), lessons: loaded.lessons, questions: loaded.questions }));
      setNotice({ ok: true, text: "The original text is back." });
    }
    wasEdited.current = loaded.edited;
  }, [loaded]);

  const patchLesson = (i: number, patch: Partial<Lesson>) => setLessons((all) => all.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const patchQuestion = (i: number, patch: Partial<Question>) => setQuestions((all) => all.map((q, j) => (j === i ? { ...q, ...patch } : q)));

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setNotice(null);
    try {
      const { version } = await save({
        tenantId,
        key: loaded.key,
        expectedVersion: baseVersion,
        title,
        summary,
        passPercent: Number(passPercent),
        lessons: lessons.map((l) => ({
          key: l.key,
          title: l.title,
          body: l.body,
          ...(l.videoUrl.trim() ? { videoUrl: l.videoUrl.trim() } : {})
        })),
        questions: questions.map((q) => ({
          key: q.key,
          prompt: q.prompt,
          options: q.options,
          correctIndex: q.correctIndex,
          ...(q.explanation.trim() ? { explanation: q.explanation.trim() } : {})
        }))
      });
      setBaseVersion(version);
      setSaved(snapshotOf({ title, summary, passPercent, lessons, questions }));
      setNotice({ ok: true, text: "Module saved. Staff see the new version straight away." });
    } catch (e) {
      setNotice({ ok: false, text: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  }

  async function restoreOriginal() {
    if (!window.confirm("Discard your company's changes to this module and go back to the original text?")) return;
    setBusy(true);
    setNotice(null);
    try {
      await restore({ tenantId, key: loaded.key });
    } catch (e) {
      setNotice({ ok: false, text: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="panel-form academy-editor" onSubmit={submit}>
      <h2>Module {loaded.number}</h2>
      <p className="hint">
        {loaded.edited
          ? `Edited by your company · version ${loaded.version}${loaded.updatedAt ? ` · saved ${new Date(loaded.updatedAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}` : ""}.`
          : "This is the original text. Saving creates your company's own version."}{" "}
        People who have already passed keep their pass and their certificate.
      </p>

      <label htmlFor="am-title">Module title</label>
      <input id="am-title" required maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} />
      <label htmlFor="am-summary">Short summary</label>
      <textarea id="am-summary" required rows={2} maxLength={400} value={summary} onChange={(e) => setSummary(e.target.value)} />
      <label htmlFor="am-pass">Pass mark (%)</label>
      <input id="am-pass" type="number" required min={50} max={100} step={1} inputMode="numeric" value={passPercent} onChange={(e) => setPassPercent(e.target.value)} />
      <p className="hint">The share of quiz questions a learner must get right, from 50 to 100.</p>

      <h3>Lessons ({lessons.length})</h3>
      {lessons.map((l, i) => (
        <LessonEditor
          key={l.key}
          lesson={l}
          index={i}
          count={lessons.length}
          onChange={(patch) => patchLesson(i, patch)}
          onMove={(by) => setLessons((all) => move(all, i, by))}
          onRemove={() => setLessons((all) => all.filter((_, j) => j !== i))}
        />
      ))}
      {lessons.length < 12 ? (
        <button type="button" className="button button-secondary button-small" onClick={() => setLessons((all) => [...all, { key: newKey("l"), title: "", body: "", videoUrl: "" }])}>
          + Add a lesson
        </button>
      ) : null}

      <h3>Quiz questions ({questions.length})</h3>
      {questions.map((q, i) => (
        <QuestionEditor
          key={q.key}
          question={q}
          index={i}
          count={questions.length}
          onChange={(patch) => patchQuestion(i, patch)}
          onMove={(by) => setQuestions((all) => move(all, i, by))}
          onRemove={() => setQuestions((all) => all.filter((_, j) => j !== i))}
        />
      ))}
      {questions.length < 30 ? (
        <button
          type="button"
          className="button button-secondary button-small"
          onClick={() => setQuestions((all) => [...all, { key: newKey("q"), prompt: "", options: ["", ""], correctIndex: 0, explanation: "" }])}
        >
          + Add a question
        </button>
      ) : null}

      {notice ? <p className={notice.ok ? "form-success" : "auth-message"} role="status">{notice.text}</p> : null}
      <div className="response-actions">
        <button className="button" type="submit" disabled={busy}>{busy ? "Saving…" : "Save module"}</button>
        {loaded.edited ? (
          <button type="button" className="button button-secondary" disabled={busy} onClick={restoreOriginal}>Restore the original text</button>
        ) : null}
      </div>
    </form>
  );
}

function Manage({ tenantId }: { tenantId: Id<"tenants"> }) {
  const [key, setKey] = useState<(typeof MODULES)[number]>("m1");
  const [dirty, setDirty] = useState(false);
  const overview = useQuery(api.academy.overview, { tenantId });
  const loaded = useQuery(api.academy.getModuleForEdit, { tenantId, key });

  return (
    <>
      <p className="muted">
        Rewrite any module to fit how your company sells. Each module needs at least one lesson and three quiz questions.
      </p>
      <div className="picker-tabs" role="tablist" aria-label="Module to edit">
        {MODULES.map((k, i) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={key === k}
            className={key === k ? "picker-tab picker-tab-on" : "picker-tab"}
            onClick={() => {
              if (k === key) return;
              if (dirty && !window.confirm("You have changes that are not saved. Leave this module without saving?")) return;
              setDirty(false);
              setKey(k);
            }}
          >
            {i + 1}. {overview?.modules[i]?.title ?? `Module ${i + 1}`}
          </button>
        ))}
      </div>
      {loaded && loaded.key === key ? (
        <ModuleEditor key={loaded.key} tenantId={tenantId} loaded={loaded} onDirty={setDirty} />
      ) : (
        <p className="muted">Loading the module…</p>
      )}
    </>
  );
}

export default function AcademyManagePage() {
  return (
    <ConfiguredOnly>
      <CompanyPage title="Edit the Sales Academy" allowedRoles={["super_admin"]}>
        {(company) => <Manage tenantId={company.tenantId} />}
      </CompanyPage>
    </ConfiguredOnly>
  );
}
