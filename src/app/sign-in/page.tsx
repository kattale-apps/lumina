"use client";

import { PasswordInput } from "@/components/PasswordInput";
import { RememberLogin } from "@/components/RememberLogin";
import { useSavedLogin, type SavedLogin } from "@/lib/savedLogin";
import Link from "next/link";
import { AuthHome } from "@/components/AuthHome";
import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useAuthActions } from "@convex-dev/auth/react";
import { useConvexAuth } from "convex/react";
import { DraftNotice, LanguagePicker, Rich, useT } from "@/lib/i18n";

function SignInForm() {
  const t = useT();
  const { signIn } = useAuthActions();
  const { isAuthenticated } = useConvexAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"signIn" | "signUp">("signIn");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const login = useSavedLogin();
  // With a saved login the form starts folded away behind a one-tap button.
  const [useOther, setUseOther] = useState(false);
  const showSaved = login.saved && !useOther && mode === "signIn";

  // Covers both a successful sign-in and arriving here already signed in.
  useEffect(() => {
    if (isAuthenticated) router.replace("/dashboard");
  }, [isAuthenticated, router]);

  async function attempt(details: SavedLogin, flow: "signIn" | "signUp") {
    const formData = new FormData();
    formData.set("email", details.email);
    formData.set("password", details.password);
    formData.set("flow", flow);
    await signIn("password", formData);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setBusy(true);
    const details = { email: email.trim().toLowerCase(), password };
    try {
      await attempt(details, mode);
      await login.afterSuccess(details);
      // Stay on "Please wait…" until the redirect to the workspace happens.
    } catch {
      setMessage(
        mode === "signIn"
          ? t("auth.signInFailed")
          : t("auth.registerFailed")
      );
      setBusy(false);
    }
  }

  async function signInSaved() {
    if (!login.saved) return;
    setMessage("");
    setBusy(true);
    const saved = login.saved;
    try {
      await attempt(saved, "signIn");
    } catch {
      // Most likely the password was changed: fall back to the form with the email filled in.
      await login.forget();
      setEmail(saved.email);
      setPassword("");
      setUseOther(true);
      setMessage(t("auth.savedFailed"));
      setBusy(false);
    }
  }

  if (!login.loaded && login.supported) return null;

  if (showSaved && login.saved) {
    return (
      <div className="auth-form">
        <div className="saved-login">
          <span className="saved-login-label">{t("auth.savedOnPhone")}</span>
          <strong>{login.saved.email}</strong>
        </div>
        {message ? <p className="auth-message" role="alert">{message}</p> : null}
        <button type="submit" disabled={busy} onClick={signInSaved}>
          {busy ? t("common.pleaseWait") : t("common.signIn")}
        </button>
        <button className="auth-mode" type="button" onClick={() => setUseOther(true)}>
          {t("auth.useOther")}
        </button>
        <button className="auth-mode auth-mode-quiet" type="button" onClick={() => login.forget()}>
          {t("auth.forgetSaved")}
        </button>
      </div>
    );
  }

  return (
    <form className="auth-form" onSubmit={submit}>
      <label htmlFor="email">{t("auth.email")}</label>
      <input
        id="email"
        type="email"
        autoComplete="email"
        required
        value={email}
        onChange={(event) => setEmail(event.target.value)}
      />
      <label htmlFor="password">{t("auth.password")}</label>
      <PasswordInput
        id="password"
        autoComplete={mode === "signIn" ? "current-password" : "new-password"}
        value={password}
        onChange={setPassword}
      />
      {login.supported ? <RememberLogin checked={login.remember} onChange={login.setRemember} /> : null}
      {message ? <p className="auth-message" role="alert">{message}</p> : null}
      <button type="submit" disabled={busy}>
        {busy ? t("common.pleaseWait") : mode === "signIn" ? t("common.signIn") : t("auth.createAccount")}
      </button>
      <button
        className="auth-mode"
        type="button"
        onClick={() => {
          setMode(mode === "signIn" ? "signUp" : "signIn");
          setMessage("");
        }}
      >
        {mode === "signIn" ? t("auth.staffRegister") : t("auth.alreadyRegistered")}
      </button>
      {mode === "signIn" ? (
        <p className="auth-note">
          <Rich text={t("auth.customerNote")} link={(label) => <Link href="/sign-up"><u>{label}</u></Link>} />
        </p>
      ) : null}
      {mode === "signUp" ? (
        <p className="auth-note">
          {t("auth.staffNote")}
        </p>
      ) : null}
    </form>
  );
}

export default function SignInPage() {
  if (!process.env.NEXT_PUBLIC_CONVEX_URL) {
    return <SignInUnavailable />;
  }
  return <SignInScreen />;
}

function SignInUnavailable() {
  const t = useT();
  {
    return (
      <main className="auth-shell">
        <section className="auth-card">
          <p className="eyebrow">{t("auth.workspace")}</p>
          <h1>{t("auth.notConfigured")}</h1>
          <p>{t("auth.notConfiguredHint")}</p>
        </section>
      </main>
    );
  }
}

function SignInScreen() {
  const t = useT();
  return (
    <main className="auth-shell">
      <section className="auth-card">
        <div className="auth-top">
          <AuthHome />
          <LanguagePicker />
        </div>
        <DraftNotice />
        <p className="eyebrow">{t("auth.workspace")}</p>
        <h1>{t("auth.welcome")}</h1>
        <p>{t("auth.welcomeHint")}</p>
        <SignInForm />
      </section>
    </main>
  );
}
