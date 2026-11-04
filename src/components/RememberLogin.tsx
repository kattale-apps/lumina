"use client";

/** Tick box shown in the Android app only: keep this email and password on the phone. */
export function RememberLogin({ checked, onChange }: { checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="remember-login">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span>
        <strong>Save my login on this phone</strong>
        <small>Next time, sign in with one tap. Leave this off on a shared phone.</small>
      </span>
    </label>
  );
}
