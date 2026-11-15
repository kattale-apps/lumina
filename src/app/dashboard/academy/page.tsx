"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { AppUpdateNeeded, savePdf } from "../../../lib/savePdf";
import { CompanyPage, ConfiguredOnly, ROLE_LABELS } from "../workspace";

function Certificate({ tenantId }: { tenantId: Id<"tenants"> }) {
  const data = useQuery(api.academy.overview, { tenantId });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!data) return null;
  const c = data.certificate;

  if (!c) {
    return (
      <section className="certificate-card" aria-labelledby="cert-h">
        <h2 id="cert-h">Your certificate</h2>
        <p className="muted">
          Pass the quiz in all {data.modules.length} modules to receive your {data.academyName} certificate.
          You have passed {data.passedCount} of {data.modules.length}.
        </p>
      </section>
    );
  }

  async function download() {
    if (!c || !data) return;
    setBusy(true);
    setError("");
    try {
      const { buildCertificatePdf } = await import("./certificatePdf");
      // The face photo goes on the certificate; without one it still prints.
      let photo: Uint8Array | null = null;
      if (c.photoUrl) {
        try {
          photo = new Uint8Array(await (await fetch(c.photoUrl)).arrayBuffer());
        } catch {
          photo = null;
        }
      }
      const bytes = await buildCertificatePdf({ academyName: data.academyName, ...c, photo });
      await savePdf(bytes, `sales-academy-certificate-${c.number}.pdf`, `${data.academyName} certificate`);
    } catch (e) {
      setError(e instanceof AppUpdateNeeded ? e.message : "We could not create the PDF. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="certificate-card certificate-earned" aria-labelledby="cert-h">
      <p className="eyebrow">CERTIFIED</p>
      <div className="certificate-holder">
        {c.photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="avatar avatar-lg" src={c.photoUrl} alt="" />
        ) : null}
        <h2 id="cert-h">🎓 {c.holderName}</h2>
      </div>
      <p>
        Completed the {data.academyName} on{" "}
        {new Date(c.issuedAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}.
      </p>
      <p className="record-meta">Certificate no. {c.number} · awarded by {c.companyName}</p>
      {!data.profileComplete ? (
        <p className="next-step-inline">
          📷 Your certificate shows your photo and full name.{" "}
          <Link href="/profile"><u>Set up your profile</u></Link> before downloading it.
        </p>
      ) : null}
      {error ? <p className="auth-message" role="alert">{error}</p> : null}
      <button type="button" className="button" disabled={busy} onClick={download}>
        {busy ? "Preparing PDF…" : "Download certificate (PDF)"}
      </button>
    </section>
  );
}

function Course({ tenantId }: { tenantId: Id<"tenants"> }) {
  const data = useQuery(api.academy.overview, { tenantId });
  if (!data) return <p className="muted">Loading the Academy…</p>;
  const next = data.modules.find((m) => !m.passed);

  return (
    <>
      <p className="muted">
        Four short modules that prepare you to find leads, assess what a customer needs and sell honestly.
        Read the lessons, then pass the quiz at the end of each module.
      </p>
      <div className="academy-progress" role="img" aria-label={`${data.passedCount} of ${data.modules.length} modules passed`}>
        {data.modules.map((m) => <span key={m.key} className={m.passed ? "academy-step academy-step-done" : "academy-step"} />)}
      </div>
      <p className="record-meta">{data.passedCount} of {data.modules.length} modules passed</p>

      <ol className="academy-modules">
        {data.modules.map((m, i) => (
          <li key={m.key} className="record-card">
            <div>
              <span className="record-meta">Module {i + 1}</span>
              <span className="record-title">{m.title}</span>
              <span className="record-meta">{m.summary}</span>
              <span className="pill-row">
                {m.passed ? (
                  <span className="pill pill-ok">Passed · {m.bestPercent}%</span>
                ) : m.attempts > 0 ? (
                  <span className="pill pill-warn">Best so far {m.bestPercent}% · pass mark {m.passPercent}%</span>
                ) : (
                  <span className="pill pill-muted">Not started</span>
                )}
                <span className="pill pill-info">{m.lessons} lessons · {m.questions} questions</span>
              </span>
            </div>
            <div className="record-actions">
              <Link className={m.key === next?.key ? "button button-small" : "button button-small button-secondary"} href={`/dashboard/academy/${m.key}`}>
                {m.passed ? "Review" : m.attempts > 0 ? "Continue" : "Start"}
              </Link>
            </div>
          </li>
        ))}
      </ol>

      <Certificate tenantId={tenantId} />

      {data.canEdit ? (
        <section className="workspace-section" aria-labelledby="edit-h">
          <h2 id="edit-h">Course content</h2>
          <p className="hint">Change the lessons, videos, quiz questions and pass mark of any module.</p>
          <Link className="button button-secondary" href="/dashboard/academy/manage">Edit the course</Link>
        </section>
      ) : null}
      {data.canSeeTeam ? <Team tenantId={tenantId} /> : null}
    </>
  );
}

function Team({ tenantId }: { tenantId: Id<"tenants"> }) {
  const team = useQuery(api.academy.teamProgress, { tenantId });
  if (!team) return null;
  return (
    <section className="workspace-section" aria-labelledby="team-h">
      <h2 id="team-h">Team progress</h2>
      <p className="record-meta">{team.certified} of {team.people.length} staff certified</p>
      <ul className="record-list">
        {team.people.map((p) => {
          const done = p.passed.filter(Boolean).length;
          return (
            <li key={p.userId} className="record-card">
              <div>
                <span className="record-title">{p.name}</span>
                <span className="record-meta">{ROLE_LABELS[p.role] ?? p.role}</span>
                <span className="academy-progress academy-progress-small" role="img" aria-label={`${done} of ${team.moduleCount} modules passed`}>
                  {p.passed.map((ok, i) => <span key={i} className={ok ? "academy-step academy-step-done" : "academy-step"} />)}
                </span>
              </div>
              <div className="record-actions">
                {p.certificateNumber ? (
                  <span className="pill pill-ok">Certified · {p.certificateNumber}</span>
                ) : (
                  <span className="pill pill-muted">{done} of {team.moduleCount} passed</span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export default function AcademyPage() {
  return (
    <ConfiguredOnly>
      <CompanyPage title="Solar Switch Sales Academy">
        {(company) => <Course tenantId={company.tenantId} />}
      </CompanyPage>
    </ConfiguredOnly>
  );
}
