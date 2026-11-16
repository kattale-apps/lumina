"use client";

import Link from "next/link";
import { useT } from "@/lib/i18n";

/** Way back to the public home page from the sign-in and sign-up screens. */
export function AuthHome() {
  const t = useT();
  return (
    <Link href="/" className="auth-home" aria-label={t("common.backHome")}>
      <span aria-hidden="true">‹</span>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/icons/icon-192.png" alt="" width={26} height={26} />
      <span>{t("common.home")}</span>
    </Link>
  );
}
