"use client";

import Link from "next/link";
import { AppDownload } from "@/components/AppDownload";
import { DraftNotice, LanguagePicker, Rich, useT } from "@/lib/i18n";

export default function HomePage() {
  const t = useT();
  return (
    <div className="public-bg">
      <main className="shell landing">
        <header className="topbar">
          <Link className="brand" href="/" aria-label={t("common.brandHome")}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="brand-logo" src="/icons/icon-192.png" alt="" width={38} height={38} />
            <span>SOLAR SWITCH</span>
          </Link>
          <div className="topbar-actions">
            <LanguagePicker />
            <Link className="button button-small" href="/sign-in">
              {t("common.signIn")}
            </Link>
          </div>
        </header>
        <DraftNotice />

        <section className="landing-hero">
          <h1>{t("home.title")}</h1>
          <p className="landing-copy">{t("home.intro")}</p>
          <div className="landing-actions">
            <Link className="landing-choice landing-choice-new" href="/estimate">
              <span className="landing-choice-icon" aria-hidden="true">☀️</span>
              <span>
                <strong>{t("home.newTitle")}</strong>
                <small>{t("home.newHint")}</small>
              </span>
            </Link>
            <Link className="landing-choice landing-choice-existing" href="/estimate/upgrade">
              <span className="landing-choice-icon" aria-hidden="true">🔧</span>
              <span>
                <strong>{t("home.existingTitle")}</strong>
                <small>{t("home.existingHint")}</small>
              </span>
            </Link>
            <p className="landing-secondary">
              <Rich text={t("home.account")} link={(label) => <Link href="/sign-up">{label}</Link>} />
            </p>
          </div>
          <AppDownload />
        </section>
      </main>
    </div>
  );
}
