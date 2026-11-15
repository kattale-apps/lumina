"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useAction, useConvexAuth, useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { CustomerShell } from "@/components/CustomerShell";
import { Avatar } from "@/components/Avatar";
import { WorkspaceHeader } from "../dashboard/workspace";
import { squarePhoto } from "@/lib/squarePhoto";

function message(e: unknown) {
  return e instanceof ConvexError && typeof e.data === "string" ? e.data : "Something went wrong. Check your connection and try again.";
}

function Frame({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useConvexAuth();
  const viewer = useQuery(api.users.viewerContext, isAuthenticated ? {} : "skip");
  // Staff keep their workspace menu; customers and people waiting for access get the customer frame.
  if (viewer?.state === "active") {
    return (
      <div className="shell">
        <WorkspaceHeader role={viewer.companies[0]?.role} />
        <main className="workspace">{children}</main>
      </div>
    );
  }
  return <CustomerShell signedIn>{children}</CustomerShell>;
}

function PhotoPicker({ name, photoUrl }: { name: string; photoUrl: string | null }) {
  const uploadUrl = useMutation(api.profile.generatePhotoUploadUrl);
  const setPhoto = useAction(api.profile.setPhoto);
  const removePhoto = useMutation(api.profile.removePhoto);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function use(files: File[]) {
    const file = files[0];
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      let blob: Blob;
      try {
        blob = await squarePhoto(file);
      } catch {
        throw new Error("We could not read that photo. Try another one.");
      }
      const url = await uploadUrl({});
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": blob.type }, body: blob });
      if (!res.ok) throw new Error("The photo did not upload. Check your connection.");
      const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
      await setPhoto({ storageId });
    } catch (e) {
      setError(e instanceof ConvexError ? message(e) : e instanceof Error ? e.message : message(e));
    } finally {
      setBusy(false);
    }
  }

  const picker = (label: string, selfie: boolean) => (
    <label className={selfie ? "button photo-pick" : "button button-secondary photo-pick"}>
      <input
        type="file"
        accept="image/*"
        {...(selfie ? { capture: "user" as const } : {})}
        className="visually-hidden"
        disabled={busy}
        onChange={(e) => {
          // Copy the chosen file before clearing the picker, which empties its list.
          const picked = Array.from(e.target.files ?? []);
          e.target.value = "";
          void use(picked);
        }}
      />
      {label}
    </label>
  );

  return (
    <section className="profile-photo">
      <Avatar name={name} url={photoUrl} size="xl" />
      <div className="profile-photo-actions">
        <p className="hint">
          A clear photo of your face: look at the camera, in good light, no sunglasses, just you. It appears on your
          Academy certificate.
        </p>
        {busy ? <p className="muted">Uploading your photo…</p> : null}
        <div className="profile-photo-buttons">
          {picker(photoUrl ? "📷 Retake selfie" : "📷 Take a selfie", true)}
          {picker("🖼️ Choose from gallery", false)}
        </div>
        {photoUrl && !busy ? (
          <button type="button" className="link-danger" onClick={() => void removePhoto({})}>Remove photo</button>
        ) : null}
        {error ? <p className="auth-message" role="alert">{error}</p> : null}
      </div>
    </section>
  );
}

function ProfileForm() {
  const profile = useQuery(api.profile.myProfile, {});
  const save = useMutation(api.profile.updateProfile);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (profile && !loaded) {
      // A name made from the email is only a placeholder; ask for the real one.
      setName(profile.saved ? profile.displayName : "");
      setPhone(profile.phone);
      setLoaded(true);
    }
  }, [profile, loaded]);

  if (profile === undefined) return <p className="muted">Loading your profile…</p>;
  if (profile === null) return null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setNotice(null);
    try {
      await save({ displayName: name, phone });
      setNotice({ ok: true, text: "Profile saved." });
    } catch (e) {
      setNotice({ ok: false, text: message(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h1>My profile</h1>
      {profile.complete ? (
        <p className="form-success">✅ Your profile is set up.</p>
      ) : (
        <p className="next-step-inline">Add your photo and full name to finish setting up your account.</p>
      )}
      <PhotoPicker name={profile.saved ? profile.displayName : name || profile.displayName} photoUrl={profile.photoUrl} />
      <form className="panel-form profile-form" onSubmit={submit}>
        <label htmlFor="pf-name">Full name</label>
        <input id="pf-name" required minLength={2} maxLength={80} autoComplete="name" placeholder="e.g. Amina Nakato" value={name} onChange={(e) => setName(e.target.value)} />
        <p className="hint">Written exactly as it should appear on your certificate.</p>
        <label htmlFor="pf-phone">Phone</label>
        <input id="pf-phone" type="tel" maxLength={20} autoComplete="tel" placeholder="+256 700 000000" value={phone} onChange={(e) => setPhone(e.target.value)} />
        <label htmlFor="pf-email">Email</label>
        <input id="pf-email" value={profile.email ?? ""} readOnly disabled />
        {notice ? <p className={notice.ok ? "form-success" : "auth-message"} role="status">{notice.text}</p> : null}
        <button className="button" type="submit" disabled={busy}>{busy ? "Saving…" : "Save my profile"}</button>
      </form>
    </>
  );
}

function Gate() {
  const router = useRouter();
  const { isLoading, isAuthenticated } = useConvexAuth();
  useEffect(() => {
    if (!isLoading && !isAuthenticated) router.replace("/sign-in");
  }, [isLoading, isAuthenticated, router]);
  if (isLoading || !isAuthenticated) {
    return (
      <main className="auth-shell">
        <section className="auth-card"><p className="muted">Loading…</p></section>
      </main>
    );
  }
  return (
    <Frame>
      <div className="profile-page">
        <ProfileForm />
        <p className="hint"><Link href="/dashboard"><u>Back</u></Link></p>
      </div>
    </Frame>
  );
}

export default function ProfilePage() {
  if (!process.env.NEXT_PUBLIC_CONVEX_URL) {
    return (
      <main className="auth-shell">
        <section className="auth-card"><h1>Unavailable</h1><p>Please try again later.</p></section>
      </main>
    );
  }
  return <Gate />;
}
