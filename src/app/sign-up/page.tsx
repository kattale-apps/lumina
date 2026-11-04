"use client";

import { PasswordInput } from "@/components/PasswordInput";
import { RememberLogin } from "@/components/RememberLogin";
import { useSavedLogin } from "@/lib/savedLogin";
import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useAuthActions } from "@convex-dev/auth/react";
import { useConvexAuth, useMutation } from "convex/react";
import { ConvexError } from "convex/values";
import { api } from "../../../convex/_generated/api";

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
  const { signIn } = useAuthActions();
  const { isAuthenticated } = useConvexAuth();
  const register = useMutation(api.shop.registerCustomer);
  const router = useRouter();
  const [form, setForm] = useState({ name: "", phone: "", email: "", password: "" });
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const login = useSavedLogin();

  // Once the new auth account is live, attach the customer details and go to the shop.
  useEffect(() => {
    if (!isAuthenticated || !pending.current) return;
    pending.current = false;
    register({ name: form.name, phone: form.phone })
      .then(() => router.replace(nextPath()))
      .catch((e) => {
        setMessage(
          e instanceof ConvexError && typeof e.data === "string"
            ? e.data
            : "We could not finish creating your account. Try signing in."
        );
        setBusy(false);
      });
  }, [isAuthenticated, register, router, form.name, form.phone]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setBusy(true);
    try {
      const data = new FormData();
      const email = form.email.trim().toLowerCase();
      data.set("email", email);
      data.set("password", form.password);
      data.set("name", form.name.trim());
      data.set("flow", "signUp");
      pending.current = true;
      await signIn("password", data);
      await login.afterSuccess({ email, password: form.password });
    } catch {
      pending.current = false;
      setMessage("We could not create the account. This email may already be registered. Try signing in instead.");
      setBusy(false);
    }
  }

  return (
    <form className="auth-form" onSubmit={submit}>
      <label htmlFor="su-name">Your name</label>
      <input id="su-name" required maxLength={100} autoComplete="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      <label htmlFor="su-phone">Phone</label>
      <input id="su-phone" required type="tel" maxLength={20} autoComplete="tel" placeholder="+256 700 000000" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
      <label htmlFor="su-email">Email</label>
      <input id="su-email" required type="email" autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
      <label htmlFor="su-password">Password (at least 8 characters)</label>
      <PasswordInput id="su-password" autoComplete="new-password" value={form.password} onChange={(password) => setForm({ ...form, password })} />
      {login.supported ? <RememberLogin checked={login.remember} onChange={login.setRemember} /> : null}
      {message ? <p className="auth-message" role="alert">{message}</p> : null}
      <button type="submit" disabled={busy}>{busy ? "Please wait…" : "Create my account"}</button>
      <p className="auth-note">
        Already have an account? <Link href="/sign-in"><u>Sign in</u></Link>
      </p>
    </form>
  );
}

export default function SignUpPage() {
  if (!process.env.NEXT_PUBLIC_CONVEX_URL) {
    return (
      <main className="auth-shell">
        <section className="auth-card">
          <h1>Sign-up is not available yet</h1>
          <p>Please try again later.</p>
        </section>
      </main>
    );
  }
  return (
    <main className="auth-shell">
      <section className="auth-card">
        <p className="eyebrow">SOLAR SWITCH CUSTOMERS</p>
        <h1>Create your account</h1>
        <p>Sign up to see our full product catalogue and place orders.</p>
        <SignUpForm />
      </section>
    </main>
  );
}
