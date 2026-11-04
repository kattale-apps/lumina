"use client";

import { PasswordInput } from "@/components/PasswordInput";
import Link from "next/link";
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
        <p className="eyebrow">SOLAR SWITCH WORKSPACE</p>
        <h1>Welcome back</h1>
        <p>Sign in as staff or as a customer.</p>
        <SignInForm />
      </section>
    </main>
  );
}
