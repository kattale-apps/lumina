"use client";

import { useT } from "@/lib/i18n";

/** Tick box shown in the Android app only: keep this email and password on the phone. */
export function RememberLogin({ checked, onChange }: { checked: boolean; onChange: (value: boolean) => void }) {
  const t = useT();
  return (
    <label className="remember-login">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span>
        <strong>{t("auth.remember")}</strong>
        <small>{t("auth.rememberHint")}</small>
      </span>
    </label>
  );
}
