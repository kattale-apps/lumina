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
import { useT } from "@/lib/i18n";

function message(e: unknown, fallback: string) {
  return e instanceof ConvexError && typeof e.data === "string" ? e.data : fallback;
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
  const t = useT();
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
        throw new Error(t("profile.photoUnreadable"));
      }
      const url = await uploadUrl({});
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": blob.type }, body: blob });
      if (!res.ok) throw new Error(t("profile.photoUploadFailed"));
      const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
      await setPhoto({ storageId });
    } catch (e) {
      setError(e instanceof ConvexError ? message(e, t("common.genericError")) : e instanceof Error ? e.message : t("common.genericError"));
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
        <p className="hint">{t("profile.photoHint")}</p>
        {busy ? <p className="muted">{t("profile.uploading")}</p> : null}
        <div className="profile-photo-buttons">
          {picker(photoUrl ? t("profile.retakeSelfie") : t("profile.takeSelfie"), true)}
          {picker(t("profile.gallery"), false)}
        </div>
        {photoUrl && !busy ? (
          <button type="button" className="link-danger" onClick={() => void removePhoto({})}>{t("profile.removePhoto")}</button>
        ) : null}
        {error ? <p className="auth-message" role="alert">{error}</p> : null}
      </div>
    </section>
  );
}

function ProfileForm() {
  const t = useT();
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

  if (profile === undefined) return <p className="muted">{t("profile.loading")}</p>;
  if (profile === null) return null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setNotice(null);
    try {
      await save({ displayName: name, phone });
      setNotice({ ok: true, text: t("profile.saved") });
    } catch (e) {
      setNotice({ ok: false, text: message(e, t("common.genericError")) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h1>{t("profile.title")}</h1>
      {profile.complete ? (
        <p className="form-success">{t("profile.done")}</p>
      ) : (
        <p className="next-step-inline">{t("profile.todo")}</p>
      )}
      <PhotoPicker name={profile.saved ? profile.displayName : name || profile.displayName} photoUrl={profile.photoUrl} />
      <form className="panel-form profile-form" onSubmit={submit}>
        <label htmlFor="pf-name">{t("profile.fullName")}</label>
        <input id="pf-name" required minLength={2} maxLength={80} autoComplete="name" placeholder={t("profile.fullNamePlaceholder")} value={name} onChange={(e) => setName(e.target.value)} />
        <p className="hint">{t("profile.fullNameHint")}</p>
        <label htmlFor="pf-phone">{t("profile.phone")}</label>
        <input id="pf-phone" type="tel" maxLength={20} autoComplete="tel" placeholder="+256 700 000000" value={phone} onChange={(e) => setPhone(e.target.value)} />
        <label htmlFor="pf-email">{t("profile.email")}</label>
        <input id="pf-email" value={profile.email ?? ""} readOnly disabled />
        {notice ? <p className={notice.ok ? "form-success" : "auth-message"} role="status">{notice.text}</p> : null}
        <button className="button" type="submit" disabled={busy}>{busy ? t("profile.saving") : t("profile.save")}</button>
      </form>
    </>
  );
}

function Gate() {
  const t = useT();
  const router = useRouter();
  const { isLoading, isAuthenticated } = useConvexAuth();
  useEffect(() => {
    if (!isLoading && !isAuthenticated) router.replace("/sign-in");
  }, [isLoading, isAuthenticated, router]);
  if (isLoading || !isAuthenticated) {
    return (
      <main className="auth-shell">
        <section className="auth-card"><p className="muted">{t("common.loading")}</p></section>
      </main>
    );
  }
  return (
    <Frame>
      <div className="profile-page">
        <ProfileForm />
        <p className="hint"><Link href="/dashboard"><u>{t("common.back")}</u></Link></p>
      </div>
    </Frame>
  );
}

export default function ProfilePage() {
  if (!process.env.NEXT_PUBLIC_CONVEX_URL) return <Unavailable />;
  return <Gate />;
}

function Unavailable() {
  const t = useT();
  return (
    <main className="auth-shell">
      <section className="auth-card"><h1>{t("common.unavailable")}</h1><p>{t("common.tryLater")}</p></section>
    </main>
  );
}
