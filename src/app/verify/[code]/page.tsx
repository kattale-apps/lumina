"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Avatar } from "@/components/Avatar";
import { DraftNotice, LanguagePicker, useT } from "@/lib/i18n";

function Shell({ children }: { children: React.ReactNode }) {
  const t = useT();
  return (
    <div className="public-bg">
      <div className="shell">
        <header className="topbar">
          <Link className="brand" href="/" aria-label={t("common.brandHome")}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="brand-logo" src="/icons/icon-192.png" alt="" width={38} height={38} />
            <span>SOLAR SWITCH</span>
          </Link>
          <LanguagePicker />
        </header>
        <DraftNotice />
        <main className="workspace verify-page">{children}</main>
      </div>
    </div>
  );
}

function Certificate({ code }: { code: string }) {
  const t = useT();
  const c = useQuery(api.academy.verifyCertificate, { code });
  if (c === undefined) return <p className="muted">{t("verify.checking")}</p>;
  if (c === null) {
    return (
      <section className="verify-card verify-invalid">
        <p className="verify-status">{t("verify.invalid")}</p>
        <p>{t("verify.invalidText")}</p>
      </section>
    );
  }
  const issued = new Date(c.issuedAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  return (
    <section className="verify-card" aria-labelledby="verify-name">
      <p className="verify-status">{t("verify.valid")}</p>
      <p className="verify-academy">{c.academyName.toUpperCase()}</p>
      <div className="verify-holder">
        <Avatar name={c.holderName} url={c.photoUrl} size="xl" />
        <div>
          <p className="verify-label">{t("verify.awardedTo")}</p>
          <h1 id="verify-name">{c.holderName}</h1>
          <p className="muted">{t("verify.issued", { date: issued, company: c.companyName })}</p>
        </div>
      </div>
      <p>{t("verify.completed", { count: c.modules.length })}</p>
      <ol className="verify-modules">
        {c.modules.map((m) => (
          <li key={m.title}>
            <span>{m.title}</span>
            <strong>{m.scorePercent}%</strong>
          </li>
        ))}
      </ol>
      <dl className="verify-facts">
        <div><dt>{t("verify.number")}</dt><dd>{c.number}</dd></div>
        <div><dt>{t("verify.awardedBy")}</dt><dd>{c.companyName}</dd></div>
      </dl>
      <p className="hint">{t("verify.disclaimer")}</p>
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
