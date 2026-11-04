"use client";

import { useState } from "react";

type Props = {
  id: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: "current-password" | "new-password";
  minLength?: number;
};

/**
 * Password box that shows what is typed by default, so people can check it on a phone,
 * with an eye button to hide it when someone is looking over their shoulder.
 */
export function PasswordInput({ id, value, onChange, autoComplete, minLength = 8 }: Props) {
  const [visible, setVisible] = useState(true);
  return (
    <div className="password-box">
      <input
        id={id}
        type={visible ? "text" : "password"}
        // While the password shows as plain text, keep the phone's saved-login popup off it:
        // that popup sits on top of the box being typed in.
        autoComplete={visible ? "off" : autoComplete}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        minLength={minLength}
        required
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      <button
        type="button"
        className="password-eye"
        aria-controls={id}
        aria-pressed={!visible}
        aria-label={visible ? "Hide password" : "Show password"}
        onClick={() => setVisible(!visible)}
      >
        {visible ? (
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.6A17 17 0 0 0 2 12s3.6 7 10 7a9.7 9.7 0 0 0 5.4-1.6" />
            <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
            <path d="M3 3l18 18" />
          </svg>
        )}
      </button>
    </div>
  );
}
