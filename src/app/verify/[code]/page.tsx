"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Avatar } from "@/components/Avatar";

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="public-bg">
      <div className="shell">
        <header className="topbar">
          <Link className="brand" href="/" aria-label="Solar Switch home">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="brand-logo" src="/icons/icon-192.png" alt="" width={38} height={38} />
            <span>SOLAR SWITCH</span>
          </Link>
        </header>
        <main className="workspace verify-page">{children}</main>
      </div>
    </div>
  );
}

function Certificate({ code }: { code: string }) {
  const c = useQuery(api.academy.verifyCertificate, { code });
  if (c === undefined) return <p className="muted">Checking the certificate…</p>;
  if (c === null) {
    return (
      <section className="verify-card verify-invalid">
        <p className="verify-status">✕ Not a valid certificate</p>
        <p>
          No Solar Switch certificate matches this code. Check that the whole QR code was scanned, or ask the holder for
          the certificate.
        </p>
      </section>
    );
  }
  const issued = new Date(c.issuedAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  return (
    <section className="verify-card" aria-labelledby="verify-name">
      <p className="verify-status">✓ Verified certificate</p>
      <p className="verify-academy">{c.academyName.toUpperCase()}</p>
      <div className="verify-holder">
        <Avatar name={c.holderName} url={c.photoUrl} size="xl" />
        <div>
          <p className="verify-label">Certificate of Completion awarded to</p>
          <h1 id="verify-name">{c.holderName}</h1>
          <p className="muted">Issued {issued} by {c.companyName}</p>
        </div>
      </div>
      <p>Completed all {c.modules.length} modules and passed the assessment for each one:</p>
      <ol className="verify-modules">
        {c.modules.map((m) => (
          <li key={m.title}>
            <span>{m.title}</span>
            <strong>{m.scorePercent}%</strong>
          </li>
        ))}
      </ol>
      <dl className="verify-facts">
        <div><dt>Certificate no.</dt><dd>{c.number}</dd></div>
        <div><dt>Awarded by</dt><dd>{c.companyName}</dd></div>
      </dl>
      <p className="hint">A record of sales training. It is not an electrical or installation qualification.</p>
    </section>
  );
}

export default function VerifyPage() {
  const params = useParams<{ code: string }>();
  if (!process.env.NEXT_PUBLIC_CONVEX_URL) {
    return <Shell><p>Verification is not available right now.</p></Shell>;
  }
  return (
    <Shell>
      <Certificate code={params.code} />
    </Shell>
  );
}
