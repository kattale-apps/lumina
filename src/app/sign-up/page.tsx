"use client";

import { PasswordInput } from "@/components/PasswordInput";
import { RememberLogin } from "@/components/RememberLogin";
import { useSavedLogin } from "@/lib/savedLogin";
import Link from "next/link";
import { AuthHome } from "@/components/AuthHome";
import { DraftNotice, LanguagePicker, Rich, useT } from "@/lib/i18n";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useAuthActions } from "@convex-dev/auth/react";
import { useMutation } from "convex/react";
import { ConvexError } from "convex/values";
import { api } from "../../../convex/_generated/api";
import { STILL_SIGNING_IN } from "../../../convex/lib/signup";

/** Where to go after signing up: only paths on this site, defaulting to the shop. */
function nextPath() {
  try {
    const next = new URLSearchParams(window.location.search).get("next");
    return next && next.startsWith("/") && !next.startsWith("//") ? next : "/shop";
  } catch {
    return "/shop";
  }
}

function SignUpForm() {
  const t = useT();
  const { signIn } = useAuthActions();
  const register = useMutation(api.shop.registerCustomer);
  const router = useRouter();
  const [form, setForm] = useState({ name: "", phone: "", email: "", password: "" });
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState(false);
  const fallback = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const login = useSavedLogin();

  // If the page is left normally, the hard-navigation fallback must not fire afterwards.
  useEffect(() => () => clearTimeout(fallback.current), []);

  /**
   * Attaches the customer details to the account just created. Waits for the new login to be
   * the one in use (the server checks the email) instead of waiting for a sign-in state change,
   * which never comes when the phone was still signed in as someone else.
   */
  async function attachDetails(email: string) {
    for (let attempt = 0; ; attempt++) {
      try {
        await register({ name: form.name.trim(), phone: form.phone.trim(), email });
        return;
      } catch (e) {
        const text = e instanceof ConvexError && typeof e.data === "string" ? e.data : "";
        if (text !== STILL_SIGNING_IN || attempt >= 12) throw e;
        await new Promise((resolve) => setTimeout(resolve, 600));
      }
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setBusy(true);
    const email = form.email.trim().toLowerCase();
    try {
      const data = new FormData();
      data.set("email", email);
      data.set("password", form.password);
      data.set("name", form.name.trim());
      data.set("flow", "signUp");
      await signIn("password", data);
    } catch {
      setMessage(t("signup.failed"));
      setBusy(false);
      return;
    }
    // The account exists from here on. Whatever happens next, the shop can finish the details.
    setCreated(true);
    try {
      await attachDetails(email);
      await login.afterSuccess({ email, password: form.password }).catch(() => undefined);
    } catch (e) {
      setMessage(e instanceof ConvexError && typeof e.data === "string" && e.data !== STILL_SIGNING_IN ? e.data : t("signup.finishFailed"));
      setBusy(false);
      return;
    }
    const next = nextPath();
    router.replace(next);
    // If the in-app navigation does not happen, load the page directly.
    fallback.current = setTimeout(() => window.location.assign(next), 3000);
  }

  return (
    <form className="auth-form" onSubmit={submit}>
      <label htmlFor="su-name">{t("signup.name")}</label>
      <input id="su-name" required maxLength={100} autoComplete="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      <label htmlFor="su-phone">{t("signup.phone")}</label>
      <input id="su-phone" required type="tel" maxLength={20} autoComplete="tel" placeholder="+256 700 000000" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
      <label htmlFor="su-email">{t("auth.email")}</label>
      <input id="su-email" required type="email" autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
      <label htmlFor="su-password">{t("signup.passwordRule")}</label>
      <PasswordInput id="su-password" autoComplete="new-password" value={form.password} onChange={(password) => setForm({ ...form, password })} />
      {login.supported ? <RememberLogin checked={login.remember} onChange={login.setRemember} /> : null}
      {message ? <p className="auth-message" role="alert">{message}</p> : null}
      {created && message ? (
        <p className="auth-note"><Link className="button" href={nextPath()}>{t("shop.continue")}</Link></p>
      ) : null}
      <button type="submit" disabled={busy}>{busy ? t("common.pleaseWait") : t("signup.submit")}</button>
      <p className="auth-note">
        <Rich text={t("signup.haveAccount")} link={(label) => <Link href="/sign-in"><u>{label}</u></Link>} />
      </p>
    </form>
  );
}

export default function SignUpPage() {
  if (!process.env.NEXT_PUBLIC_CONVEX_URL) {
    return <SignUpUnavailable />;
  }
  return <SignUpScreen />;
}

function SignUpUnavailable() {
  const t = useT();
  {
    return (
      <main className="auth-shell">
        <section className="auth-card">
          <h1>{t("signup.unavailable")}</h1>
          <p>{t("common.tryLater")}</p>
        </section>
      </main>
    );
  }
}

function SignUpScreen() {
  const t = useT();
  return (
    <main className="auth-shell">
      <section className="auth-card">
        <div className="auth-top">
          <AuthHome />
          <LanguagePicker />
        </div>
        <DraftNotice />
        <p className="eyebrow">{t("auth.customers")}</p>
        <h1>{t("signup.title")}</h1>
        <p>{t("signup.intro")}</p>
        <SignUpForm />
      </section>
    </main>
  );
}
