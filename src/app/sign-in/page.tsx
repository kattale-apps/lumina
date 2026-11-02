"use client";

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

  // Covers both a successful sign-in and arriving here already signed in.
  useEffect(() => {
    if (isAuthenticated) router.replace("/dashboard");
  }, [isAuthenticated, router]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setBusy(true);

    try {
      const formData = new FormData();
      formData.set("email", email.trim().toLowerCase());
      formData.set("password", password);
      formData.set("flow", mode);
      await signIn("password", formData);
    } catch {
      setMessage(
        mode === "signIn"
          ? "Sign-in failed. Check your email and password."
          : "Account registration failed. Check the details and try again."
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="auth-form" onSubmit={submit}>
      <label htmlFor="email">Work email</label>
      <input
        id="email"
        type="email"
        autoComplete="email"
        required
        value={email}
        onChange={(event) => setEmail(event.target.value)}
      />
      <label htmlFor="password">Password</label>
      <input
        id="password"
        type="password"
        autoComplete={mode === "signIn" ? "current-password" : "new-password"}
        minLength={8}
        required
        value={password}
        onChange={(event) => setPassword(event.target.value)}
      />
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
        {mode === "signIn" ? "New to Solar Switch? Create an account" : "Already registered? Sign in"}
      </button>
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
        <p className="eyebrow">SOLAR SWITCH WORKSPACE</p>
        <h1>Welcome back</h1>
        <p>Sign in to continue to solar assessments, system designs and quotations.</p>
        <SignInForm />
      </section>
    </main>
  );
}
