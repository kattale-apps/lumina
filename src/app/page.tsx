import Link from "next/link";
import { AppDownload } from "@/components/AppDownload";

export default function HomePage() {
  return (
    <div className="public-bg">
      <main className="shell landing">
        <header className="topbar">
          <Link className="brand" href="/" aria-label="Solar Switch home">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="brand-logo" src="/icons/icon-192.png" alt="" width={38} height={38} />
            <span>SOLAR SWITCH</span>
          </Link>
          <Link className="button button-small" href="/sign-in">
            Sign in
          </Link>
        </header>

        <section className="landing-hero">
          <h1>We help everyone find the right solar system.</h1>
          <p className="landing-copy">
            Tell us what you use today and see the solar options that could fit your home or business.
            It takes about two minutes.
          </p>
          <div className="landing-actions">
            <Link className="landing-choice landing-choice-new" href="/estimate">
              <span className="landing-choice-icon" aria-hidden="true">☀️</span>
              <span>
                <strong>Check my power needs</strong>
                <small>New to solar? See what you use and the systems that fit.</small>
              </span>
            </Link>
            <Link className="landing-choice landing-choice-existing" href="/estimate/upgrade">
              <span className="landing-choice-icon" aria-hidden="true">🔧</span>
              <span>
                <strong>Upgrade or fix my system</strong>
                <small>Already have solar? Add more, or replace a faulty part.</small>
              </span>
            </Link>
            <p className="landing-secondary">
              Want to see our products and order? <Link href="/sign-up">Create an account</Link>
            </p>
          </div>
          <AppDownload />
        </section>
      </main>
    </div>
  );
}
