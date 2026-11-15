import Link from "next/link";

/** Way back to the public home page from the sign-in and sign-up screens. */
export function AuthHome() {
  return (
    <Link href="/" className="auth-home" aria-label="Back to the Solar Switch home page">
      <span aria-hidden="true">‹</span>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/icons/icon-192.png" alt="" width={26} height={26} />
      <span>Home</span>
    </Link>
  );
}
