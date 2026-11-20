"use client";

import { useCallback, useRef, useState } from "react";
import { shrinkImage } from "@/lib/shrinkImage";
import { siteUrl } from "@/lib/savePdf";
import { useT, type MessageKey } from "@/lib/i18n";

/** What the photo must show to be useful, by what it is of. */
const NEEDS: Record<string, MessageKey> = {
  appliance: "photos.need.appliance",
  inverter: "photos.need.inverter",
  panels: "photos.need.panels",
  batteries: "photos.need.batteries",
  controller: "photos.need.controller"
};

type LocalPhoto = {
  localId: string;
  preview: string;
  status: "uploading" | "ready" | "failed";
  photoId?: string;
  token?: string;
};

type Slot = { part: string; label: string };

const MAX_PER_SLOT = 3;

/** Uploads one photo for a request; the answer is attached when the request is sent. */
async function uploadPhoto(blob: Blob): Promise<{ photoId: string; token: string }> {
  const res = await fetch(`${siteUrl()}/request-photo`, { method: "POST", headers: { "Content-Type": blob.type || "image/jpeg" }, body: blob });
  if (!res.ok) throw new Error(`photo ${res.status}`);
  return (await res.json()) as { photoId: string; token: string };
}

/**
 * Optional nameplate photos, kept per thing photographed (an appliance, the inverter…).
 * Each photo uploads as soon as it is chosen; `forRequest()` lists the ready ones to send.
 */
export function usePhotoSet() {
  const [byKey, setByKey] = useState<Record<string, LocalPhoto[]>>({});
  const slots = useRef<Record<string, Slot>>({});
  // The latest lists, so the per-item limit is counted correctly when several photos are chosen.
  const latest = useRef(byKey);
  latest.current = byKey;

  const add = useCallback(async (key: string, slot: Slot, files: File[]) => {
    slots.current[key] = slot;
    const room = MAX_PER_SLOT - (latest.current[key]?.length ?? 0);
    const chosen = files.slice(0, Math.max(0, room)).map((file) => ({
      file,
      photo: { localId: Math.random().toString(36).slice(2), preview: URL.createObjectURL(file), status: "uploading" as const }
    }));
    if (!chosen.length) return;
    setByKey((all) => ({ ...all, [key]: [...(all[key] ?? []), ...chosen.map((c) => c.photo)] }));
    for (const { file, photo } of chosen) {
      const update = (patch: Partial<LocalPhoto>) =>
        setByKey((all) => ({ ...all, [key]: (all[key] ?? []).map((p) => (p.localId === photo.localId ? { ...p, ...patch } : p)) }));
      try {
        const saved = await uploadPhoto(await shrinkImage(file));
        update({ status: "ready", ...saved });
      } catch {
        update({ status: "failed" });
      }
    }
  }, []);

  const remove = useCallback((key: string, localId: string) => {
    setByKey((all) => ({ ...all, [key]: (all[key] ?? []).filter((p) => p.localId !== localId) }));
  }, []);

  /** Photos to send with the request, for the things still in it. */
  const forRequest = useCallback(
    (keep: (key: string) => boolean = () => true) =>
      Object.entries(byKey).flatMap(([key, list]) =>
        keep(key)
          ? list.filter((p) => p.status === "ready").map((p) => ({ photoId: p.photoId!, token: p.token!, part: slots.current[key]?.part ?? "other", label: slots.current[key]?.label ?? "Nameplate" }))
          : []
      ),
    [byKey]
  );

  const uploading = Object.values(byKey).some((list) => list.some((p) => p.status === "uploading"));
  return { byKey, add, remove, forRequest, uploading };
}

export type PhotoSet = ReturnType<typeof usePhotoSet>;

/** The "Add a nameplate photo" button with thumbnails, for one thing (an appliance, the inverter…). */
export function NameplatePhotos({ set, photoKey, part, label }: { set: PhotoSet; photoKey: string; part: string; label: string }) {
  const t = useT();
  const photos = set.byKey[photoKey] ?? [];
  return (
    <div className="nameplate-photos">
      {photos.length ? (
        <div className="nameplate-thumbs">
          {photos.map((p) => (
            <div key={p.localId} className={`nameplate-thumb nameplate-${p.status}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.preview} alt={t("photos.alt", { label })} />
              {p.status !== "ready" ? <span className="nameplate-state">{p.status === "uploading" ? t("photos.uploading") : t("photos.failed")}</span> : null}
              <button type="button" aria-label={t("photos.remove")} onClick={() => set.remove(photoKey, p.localId)}>×</button>
            </div>
          ))}
        </div>
      ) : null}
      {photos.length < MAX_PER_SLOT ? (
        <p className="nameplate-need">⚡ {t(NEEDS[part] ?? "photos.need.appliance")}</p>
      ) : null}
      {photos.length < MAX_PER_SLOT ? (
        <label className="nameplate-add">
          {/* No "capture": phones then offer both the camera and the gallery. */}
          <input
            type="file"
            accept="image/*"
            multiple
            className="visually-hidden"
            onChange={(e) => {
              // Copy the chosen files before clearing the picker, which empties its list.
              const files = Array.from(e.target.files ?? []);
              e.target.value = "";
              void set.add(photoKey, { part, label }, files);
            }}
          />
          <span aria-hidden="true">📷</span> {photos.length ? t("photos.addAnother") : t("photos.add")}
        </label>
      ) : null}
    </div>
  );
}
