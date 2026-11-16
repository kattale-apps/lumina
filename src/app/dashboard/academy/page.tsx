"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { AppUpdateNeeded, savePdf } from "../../../lib/savePdf";
import { CompanyPage, ConfiguredOnly, ROLE_LABELS } from "../workspace";
import { DraftNotice, LanguagePicker, Rich, useLanguage } from "@/lib/i18n";

function Certificate({ tenantId }: { tenantId: Id<"tenants"> }) {
  const { t, lang } = useLanguage();
  const data = useQuery(api.academy.overview, { tenantId, lang });
  const link = useMutation(api.academy.certificateLink);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!data) return null;
  const c = data.certificate;

  if (!c) {
    return (
      <section className="certificate-card" aria-labelledby="cert-h">
        <h2 id="cert-h">{t("academy.yourCertificate")}</h2>
        <p className="muted">{t("academy.passAll", { count: data.modules.length, academy: data.academyName, passed: data.passedCount })}</p>
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
      // The QR code opens this certificate on the website, so anyone can check it is genuine.
      const code = c.verifyCode ?? (await link({ tenantId })).code;
      const verifyUrl = `${window.location.origin}/verify/${code}`;
      // The Solar Switch logo, cut out, for the header, seal and tiled background.
      const asset = async (path: string) => {
        try {
          const res = await fetch(path);
          return res.ok ? new Uint8Array(await res.arrayBuffer()) : null;
        } catch {
          return null;
        }
      };
      const [logo, tileLogo] = await Promise.all([asset("/certificate/logo-navy.png"), asset("/certificate/logo-ink.png")]);
      const bytes = await buildCertificatePdf({ academyName: data.academyName, ...c, photo, verifyUrl, logo, tileLogo });
      await savePdf(bytes, `sales-academy-certificate-${c.number}.pdf`, `${data.academyName} certificate`);
    } catch (e) {
      setError(e instanceof AppUpdateNeeded ? e.message : t("academy.errPdf"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="certificate-card certificate-earned" aria-labelledby="cert-h">
      <p className="eyebrow">{t("academy.certified")}</p>
      <div className="certificate-holder">
        {c.photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="avatar avatar-lg" src={c.photoUrl} alt="" />
        ) : null}
        <h2 id="cert-h">🎓 {c.holderName}</h2>
      </div>
      <p>{t("academy.completedOn", { academy: data.academyName, date: new Date(c.issuedAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) })}</p>
      <p className="record-meta">{t("academy.certMeta", { number: c.number, company: c.companyName })}</p>
      {!data.profileComplete ? (
        <p className="next-step-inline">
          <Rich text={t("academy.profileFirst")} link={(label) => <Link href="/profile"><u>{label}</u></Link>} />
        </p>
      ) : null}
      {error ? <p className="auth-message" role="alert">{error}</p> : null}
      <button type="button" className="button" disabled={busy} onClick={download}>
        {busy ? t("academy.preparingPdf") : t("academy.downloadCertificate")}
      </button>
    </section>
  );
}

function Course({ tenantId }: { tenantId: Id<"tenants"> }) {
  const { t, lang } = useLanguage();
  const data = useQuery(api.academy.overview, { tenantId, lang });
  if (!data) return <p className="muted">{t("academy.loading")}</p>;
  const next = data.modules.find((m) => !m.passed);

  return (
    <>
      <div className="academy-language">
        <LanguagePicker />
      </div>
      <DraftNotice />
      <p className="muted">{t("academy.intro")}</p>
      <div className="academy-progress" role="img" aria-label={t("academy.progress", { passed: data.passedCount, count: data.modules.length })}>
        {data.modules.map((m) => <span key={m.key} className={m.passed ? "academy-step academy-step-done" : "academy-step"} />)}
      </div>
      <p className="record-meta">{t("academy.progress", { passed: data.passedCount, count: data.modules.length })}</p>

      <ol className="academy-modules">
        {data.modules.map((m, i) => (
          <li key={m.key} className="record-card">
            <div>
              <span className="record-meta">{t("academy.moduleN", { number: i + 1 })}</span>
              <span className="record-title">{m.title}</span>
              <span className="record-meta">{m.summary}</span>
              <span className="pill-row">
                {m.passed ? (
                  <span className="pill pill-ok">{t("academy.passed", { percent: m.bestPercent ?? 0 })}</span>
                ) : m.attempts > 0 ? (
                  <span className="pill pill-warn">{t("academy.bestSoFar", { best: m.bestPercent ?? 0, pass: m.passPercent })}</span>
                ) : (
                  <span className="pill pill-muted">{t("academy.notStarted")}</span>
                )}
                <span className="pill pill-info">{t("academy.counts", { lessons: m.lessons, questions: m.questions })}</span>
              </span>
            </div>
            <div className="record-actions">
              <Link className={m.key === next?.key ? "button button-small" : "button button-small button-secondary"} href={`/dashboard/academy/${m.key}`}>
                {m.passed ? t("academy.review") : m.attempts > 0 ? t("academy.continue") : t("academy.start")}
              </Link>
            </div>
          </li>
        ))}
      </ol>

      <Certificate tenantId={tenantId} />

      {data.canEdit ? (
        <section className="workspace-section" aria-labelledby="edit-h">
          <h2 id="edit-h">{t("academy.courseContent")}</h2>
          <p className="hint">{t("academy.courseContentHint")}</p>
          <Link className="button button-secondary" href="/dashboard/academy/manage">{t("academy.editCourse")}</Link>
        </section>
      ) : null}
      {data.canSeeTeam ? <Team tenantId={tenantId} /> : null}
    </>
  );
}

function Team({ tenantId }: { tenantId: Id<"tenants"> }) {
  const { t } = useLanguage();
  const team = useQuery(api.academy.teamProgress, { tenantId });
  if (!team) return null;
  return (
    <section className="workspace-section" aria-labelledby="team-h">
      <h2 id="team-h">{t("academy.team")}</h2>
      <p className="record-meta">{t("academy.teamCertified", { certified: team.certified, count: team.people.length })}</p>
      <ul className="record-list">
        {team.people.map((p) => {
          const done = p.passed.filter(Boolean).length;
          return (
            <li key={p.userId} className="record-card">
              <div>
                <span className="record-title">{p.name}</span>
                <span className="record-meta">{ROLE_LABELS[p.role] ?? p.role}</span>
                <span className="academy-progress academy-progress-small" role="img" aria-label={t("academy.progress", { passed: done, count: team.moduleCount })}>
                  {p.passed.map((ok, i) => <span key={i} className={ok ? "academy-step academy-step-done" : "academy-step"} />)}
                </span>
              </div>
              <div className="record-actions">
                {p.certificateNumber ? (
                  <span className="pill pill-ok">{t("academy.teamCertifiedPill", { number: p.certificateNumber })}</span>
                ) : (
                  <span className="pill pill-muted">{t("academy.teamPassed", { passed: done, count: team.moduleCount })}</span>
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
