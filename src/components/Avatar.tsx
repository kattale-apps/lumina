/** A round profile photo, or the person's initials on a green circle when there is none. */
export function Avatar({ name, url, size = "md" }: { name: string; url: string | null | undefined; size?: "sm" | "md" | "lg" | "xl" }) {
  const initials =
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? "")
      .join("") || "?";
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img className={`avatar avatar-${size}`} src={url} alt="" />;
  }
  return (
    <span className={`avatar avatar-${size} avatar-initials`} aria-hidden="true">
      {initials}
    </span>
  );
}
