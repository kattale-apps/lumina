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
            <Link className="button button-large landing-cta" href="/estimate">
              Check my power needs
            </Link>
            <p className="landing-secondary">
              Already have solar? <Link href="/estimate/upgrade">Check what you can add to it</Link>
            </p>
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
