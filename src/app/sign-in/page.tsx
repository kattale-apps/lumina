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

function SignInForm() {
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
          ? "Sign-in failed. Check your email and password."
          : "Account registration failed. Check the details and try again."
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
      setMessage("Your saved login did not work. Type your password again.");
      setBusy(false);
    }
  }

  if (!login.loaded && login.supported) return null;

  if (showSaved && login.saved) {
    return (
      <div className="auth-form">
        <div className="saved-login">
          <span className="saved-login-label">Saved on this phone</span>
          <strong>{login.saved.email}</strong>
        </div>
        {message ? <p className="auth-message" role="alert">{message}</p> : null}
        <button type="submit" disabled={busy} onClick={signInSaved}>
          {busy ? "Please wait…" : "Sign in"}
        </button>
        <button className="auth-mode" type="button" onClick={() => setUseOther(true)}>
          Use a different account
        </button>
        <button className="auth-mode auth-mode-quiet" type="button" onClick={() => login.forget()}>
          Remove saved login from this phone
        </button>
      </div>
    );
  }

  return (
    <form className="auth-form" onSubmit={submit}>
      <label htmlFor="email">Email</label>
      <input
        id="email"
        type="email"
        autoComplete="email"
        required
        value={email}
        onChange={(event) => setEmail(event.target.value)}
      />
      <label htmlFor="password">Password</label>
      <PasswordInput
        id="password"
        autoComplete={mode === "signIn" ? "current-password" : "new-password"}
        value={password}
        onChange={setPassword}
      />
      {login.supported ? <RememberLogin checked={login.remember} onChange={login.setRemember} /> : null}
      {message ? <p className="auth-message" role="alert">{message}</p> : null}
      <button type="submit" disabled={busy}>
        {busy ? "Please wait…" : mode === "signIn" ? "Sign in" : "Create account"}
      </button>
      <button
        className="auth-mode"
        type="button"
        onClick={() => {
          setMode(mode === "signIn" ? "signUp" : "signIn");
          setMessage("");
        }}
      >
        {mode === "signIn" ? "New staff member? Register a staff login" : "Already registered? Sign in"}
      </button>
      {mode === "signIn" ? (
        <p className="auth-note">
          Customer? <Link href="/sign-up"><u>Create a customer account</u></Link> to see the catalogue and order.
        </p>
      ) : null}
      {mode === "signUp" ? (
        <p className="auth-note">
          Creating an account does not grant access to a company workspace. A Solar Switch
          administrator must activate your company membership and role.
        </p>
      ) : null}
    </form>
  );
}

export default function SignInPage() {
  if (!process.env.NEXT_PUBLIC_CONVEX_URL) {
    return (
      <main className="auth-shell">
        <section className="auth-card">
          <p className="eyebrow">SOLAR SWITCH WORKSPACE</p>
          <h1>Authentication is not configured yet</h1>
          <p>Add the Convex deployment URL to the application environment before signing in.</p>
        </section>
      </main>
    );
  }

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <AuthHome />
        <p className="eyebrow">SOLAR SWITCH WORKSPACE</p>
        <h1>Welcome back</h1>
        <p>Sign in as staff or as a customer.</p>
        <SignInForm />
      </section>
    </main>
  );
}
