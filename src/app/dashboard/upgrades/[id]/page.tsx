"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { AppUpdateNeeded, savePdf } from "../../../../lib/savePdf";
import { describeNeeds, describeSystem } from "../../../estimate/upgrade/describe";
import { money, selectionTotal, toggleOption, UpgradeReport } from "../../../estimate/upgrade/UpgradeReport";
import { STATUS_LABELS } from "../../quotes";
import { CompanyPage, ConfiguredOnly, errorMessage } from "../../workspace";

function Verify({ studyId }: { studyId: Id<"upgradeStudies"> }) {
  const verify = useMutation(api.upgrades.verifyStudy);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await verify({ studyId, note });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="panel-form" onSubmit={submit}>
      <h2>Verify the existing system</h2>
      <p className="hint">
        Confirm that the ratings above match the real equipment, and say how you checked: a site visit, nameplate
        photos or datasheets. A quotation built on this study cannot be approved until this is recorded. If a rating is
        wrong, run a new check with the right figures instead.
      </p>
      <label htmlFor="uv-note">How the ratings were verified</label>
      <textarea id="uv-note" required rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
      {error ? <p className="auth-message" role="alert">{error}</p> : null}
      <button className="button" type="submit" disabled={busy}>{busy ? "Saving…" : "Record verification"}</button>
    </form>
  );
}

function Study({ studyId }: { studyId: Id<"upgradeStudies"> }) {
  const router = useRouter();
  const study = useQuery(api.upgrades.getStudy, { studyId });
  const createQuotation = useMutation(api.quotations.createFromUpgradeStudy);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [error, setError] = useState("");

  if (!study) return <p className="muted">Loading the study…</p>;
  const { report } = study;
  const usable = report.blockers.length === 0;
  const total = selectionTotal(report, selected);

  async function quote() {
    setBusy(true);
    setError("");
    try {
      const { quotationId } = await createQuotation({ studyId, optionKeys: selected });
      router.push(`/dashboard/quotations/${quotationId}`);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  async function downloadReport() {
    if (!study) return;
    setPdfBusy(true);
    setError("");
    try {
      const { buildUpgradeReportPdf } = await import("../../../estimate/upgrade/upgradeReportPdf");
      const bytes = await buildUpgradeReportPdf({
        companyName: study.companyName,
        customerName: study.customerName,
        preparedAt: study.createdAt,
        systemLines: describeSystem(study.system),
        needsLines: describeNeeds(study.needs),
        report: study.report,
        selected,
        verification: study.verification
      });
      await savePdf(bytes, `solar-upgrade-report-${new Date(study.createdAt).toISOString().slice(0, 10)}.pdf`, "Solar upgrade report");
    } catch (e) {
      setError(e instanceof AppUpdateNeeded ? e.message : "We could not create the PDF. Please try again.");
    } finally {
      setPdfBusy(false);
    }
  }

  return (
    <>
      <p><Link className="back-link" href="/dashboard/upgrades">← Upgrade checks</Link></p>
      <section className="lead-block">
        <h2>
          <Link href={`/dashboard/customers/${study.customerId}`}>{study.customerName}</Link> · {study.siteName}
        </h2>
        <p className="record-meta">Saved {new Date(study.createdAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</p>
        <ul className="upgrade-summary">
          {[...describeSystem(study.system), ...describeNeeds(study.needs)].map((line) => <li key={line}>{line}</li>)}
        </ul>
        {study.verification ? (
          <p className="lead-reach lead-reach-ok">
            Ratings verified by {study.verification.verifierName} on{" "}
            {new Date(study.verification.verifiedAt).toLocaleDateString("en-GB", { dateStyle: "medium" })}: {study.verification.note}
          </p>
        ) : (
          <p className="lead-reach">These ratings were typed in and have not been verified by a technician yet.</p>
        )}
        <p className="hint">A study is a fixed record. To change a figure, <Link href="/dashboard/upgrades/new"><u>run a new check</u></Link>.</p>
      </section>

      {study.can.verify ? <Verify studyId={studyId} /> : null}

      <section className="estimate-results">
        <UpgradeReport
          report={report}
          selected={selected}
          onToggle={usable && study.can.quote ? (key) => setSelected((s) => toggleOption(report, s, key)) : undefined}
        />
      </section>

      {error ? <p className="auth-message" role="alert">{error}</p> : null}
      <section className="panel-form" aria-labelledby="up-next">
        <h2 id="up-next">Report and quotation</h2>
        <button type="button" className="button button-secondary" disabled={pdfBusy} onClick={downloadReport}>
          {pdfBusy ? "Preparing PDF…" : "Download the report (PDF)"}
        </button>
        {usable && study.can.quote ? (
          <>
            <p className="hint">
              Choose one option for each part the customer wants, above, then create a quotation from them. The quotation
              stays illustrative until a technician has verified the system and approved it.
            </p>
            {selected.length > 0 ? (
              <p>
                <strong>{selected.length} option{selected.length === 1 ? "" : "s"} chosen</strong>
                {total !== null ? ` · ${money(total, report.exponent, report.currency)} at list price` : ""}
              </p>
            ) : null}
            <button type="button" className="button" disabled={busy || selected.length === 0} onClick={quote}>
              {busy ? "Creating…" : "Create quotation from the chosen options"}
            </button>
          </>
        ) : null}
      </section>

      {study.quotations.length > 0 ? (
        <section className="workspace-section" aria-labelledby="up-quotes">
          <h2 id="up-quotes">Quotations from this study</h2>
          <ul className="record-list">
            {study.quotations.map((q) => (
              <li key={q.id}>
                <Link className="record-card module-link" href={`/dashboard/quotations/${q.id}`}>
                  <div>
                    <span className="record-title">{q.officialNumber ?? "Quotation"}</span>
                    <span className="record-meta">Created {new Date(q.createdAt).toLocaleDateString("en-GB", { dateStyle: "medium" })}</span>
                    <span className="pill">{STATUS_LABELS[q.status]}</span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}

export default function UpgradeStudyPage() {
  const params = useParams<{ id: string }>();
  return (
    <ConfiguredOnly>
      <CompanyPage title="Upgrade study" allowedRoles={["super_admin", "sales_manager", "sales_agent", "technician"]}>
        {() => <Study studyId={params.id as Id<"upgradeStudies">} />}
      </CompanyPage>
    </ConfiguredOnly>
  );
}
