"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { AppDownload } from "@/components/AppDownload";
import { CustomerShell } from "@/components/CustomerShell";
import { DraftNotice, LanguagePicker, Rich, useT } from "@/lib/i18n";

export default function HomePage() {
  // Without a backend there is no account to look up, so everyone gets the public page.
  if (!process.env.NEXT_PUBLIC_CONVEX_URL) return <Landing />;
  return <AccountAwareHome />;
}

/** A signed-in customer gets their dashboard; everyone else the public landing page. */
function AccountAwareHome() {
  const me = useQuery(api.shop.myAccount, {});
  if (me?.signedIn && me.account) return <CustomerHome name={me.account.name} />;
  return <Landing />;
}

function CustomerHome({ name }: { name: string }) {
  const t = useT();
  return (
    <CustomerShell signedIn>
      <section className="landing-hero customer-home">
        <h1>{t("home.welcome", { name: name.split(" ")[0] })}</h1>
        <p className="landing-copy">{t("home.welcomeIntro")}</p>
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
          <Link className="landing-choice landing-choice-recs" href="/my-requests">
            <span className="landing-choice-icon" aria-hidden="true">📋</span>
            <span>
              <strong>{t("home.recsTitle")}</strong>
              <small>{t("home.recsHint")}</small>
            </span>
          </Link>
          <Link className="landing-choice landing-choice-shop" href="/shop">
            <span className="landing-choice-icon" aria-hidden="true">🛒</span>
            <span>
              <strong>{t("home.shopTitle")}</strong>
              <small>{t("home.shopHint")}</small>
            </span>
          </Link>
        </div>
      </section>
    </CustomerShell>
  );
}

function Landing() {
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
