import Link from "next/link";

export default function HomePage() {
  return (
    <div className="public-bg">
      <main className="shell">
        <header className="topbar">
          <Link className="brand" href="/" aria-label="Solar Switch home">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="brand-logo" src="/icons/icon-192.png" alt="" width={38} height={38} />
            <span>SOLAR SWITCH</span>
          </Link>
          <div className="hero-actions" style={{ margin: 0 }}>
            <Link className="button button-small button-secondary" href="/sign-up">
              Create account
            </Link>
            <Link className="button button-small" href="/sign-in">
              Sign in
            </Link>
          </div>
        </header>

        <section className="hero">
          <h1>We help everyone find the right solar system.</h1>
          <p className="hero-copy">
            Tell us what you use today and see the solar options that could fit your home or business.
            It takes about two minutes.
          </p>
          <div className="hero-actions">
            <Link className="button button-large" href="/estimate">
              Check my power needs
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}
