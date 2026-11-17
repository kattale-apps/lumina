"use client";

import type { ReactNode } from "react";

/** "Question 2 of 4" with a progress bar, shown above the one question on screen. */
export function StepProgress({ step, total, label }: { step: number; total: number; label: string }) {
  return (
    <div className="step-progress">
      <p className="step-progress-label" aria-live="polite">{label}</p>
      <div className="step-progress-bar" role="progressbar" aria-valuemin={1} aria-valuemax={total} aria-valuenow={step} aria-label={label}>
        {Array.from({ length: total }, (_, i) => (
          <span key={i} className={i < step ? "step-progress-dot step-progress-done" : "step-progress-dot"} />
        ))}
      </div>
    </div>
  );
}

/**
 * Back / Next under the question. The Next button glows when the question on screen is answered,
 * so people who are unsure what to do are drawn to it.
 */
export function StepButtons({
  onBack,
  backLabel,
  nextLabel,
  busy,
  glowNext,
  children
}: {
  onBack?: () => void;
  backLabel: string;
  nextLabel: string;
  busy?: boolean;
  glowNext?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className="step-buttons">
      {onBack ? (
        <button type="button" className="button button-secondary" onClick={onBack} disabled={busy}>
          ← {backLabel}
        </button>
      ) : <span />}
      {children}
      <button type="submit" className={`button step-next${glowNext ? " guide-glow" : ""}`} disabled={busy}>
        {nextLabel} →
      </button>
    </div>
  );
}
