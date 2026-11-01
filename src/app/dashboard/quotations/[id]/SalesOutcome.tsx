"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { buildInstallmentPlan, type InstallmentMethod } from "../../../../../convex/lib/finance";
import { errorMessage } from "../../workspace";
import { money, toMinor } from "../../quotes";

/** Answer an issued quotation: the customer accepted it, or declined. */
export function SalesOutcome({ quotationId, role }: { quotationId: Id<"quotations">; role: string }) {
  const state = useQuery(api.operations.getOutcome, { quotationId });
  const record = useMutation(api.operations.recordOutcome);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const canAnswer = ["super_admin", "sales_manager", "sales_agent"].includes(role);

  async function run(outcome: "won" | "lost") {
    setError("");
    try {
      await record({ quotationId, outcome, reason: reason || undefined });
      setReason("");
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  if (!state) return null;
  if (state.outcome) {
    return (
      <section className="workspace-section" aria-labelledby="deal">
        <h2 id="deal">Customer response</h2>
        <p>
          <span className={state.outcome.outcome === "won" ? "pill" : "pill pill-warn"}>
            {state.outcome.outcome === "won" ? "Accepted" : "Declined"}
          </span>{" "}
          <span className="record-meta">{new Date(state.outcome.decidedAt).toLocaleString()}</span>
        </p>
        {state.outcome.reason ? <p className="record-meta">{state.outcome.reason}</p> : null}
        {state.outcome.outcome === "won" ? (
          <p><Link href="/dashboard/installations">Follow the installation →</Link></p>
        ) : null}
      </section>
    );
  }
  if (!canAnswer) return null;
  return (
    <section className="panel-form" aria-labelledby="deal">
      <h2 id="deal">Customer response</h2>
      <p className="hint">
        Mark the quotation accepted to open an installation job and keep the goods held for 60 days. A declined
        quotation needs a reason and frees the stock.
      </p>
      <label htmlFor="deal-reason">Note or reason</label>
      <input id="deal-reason" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
      {error ? <p className="auth-message" role="alert">{error}</p> : null}
      <div className="record-actions">
        <button className="button" type="button" onClick={() => void run("won")}>Customer accepted</button>
        <button className="button button-secondary" type="button" onClick={() => void run("lost")}>Customer declined</button>
      </div>
    </section>
  );
}

/** An illustrative repayment schedule. There is no lending policy yet, so it is arithmetic, not an offer. */
export function InstallmentCalculator({ totalMinor, currency }: { totalMinor: number; currency: string }) {
  const [deposit, setDeposit] = useState("0");
  const [months, setMonths] = useState("12");
  const [rate, setRate] = useState("0");
  const [method, setMethod] = useState<InstallmentMethod>("reducing");

  const result = useMemo(() => {
    try {
      return {
        plan: buildInstallmentPlan({
          priceMinor: totalMinor,
          depositMinor: toMinor(deposit || "0", currency),
          termMonths: Number(months),
          annualRateBps: Math.round(Number(rate || "0") * 100),
          method
        }),
        error: ""
      };
    } catch (e) {
      return { plan: null, error: errorMessage(e) };
    }
  }, [totalMinor, currency, deposit, months, rate, method]);

  return (
    <section className="panel-form" aria-labelledby="inst">
      <h2 id="inst">Instalment illustration</h2>
      <p className="hint">
        For discussion only. It is not a credit offer: the company has no lending terms configured in Lumina yet,
        and nothing here is stored or collected.
      </p>
      <label htmlFor="i-dep">Deposit ({currency})</label>
      <input id="i-dep" inputMode="decimal" value={deposit} onChange={(e) => setDeposit(e.target.value)} />
      <label htmlFor="i-term">Term (months, 1–60)</label>
      <input id="i-term" inputMode="numeric" value={months} onChange={(e) => setMonths(e.target.value)} />
      <label htmlFor="i-rate">Yearly interest rate (%)</label>
      <input id="i-rate" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} />
      <label htmlFor="i-method">Interest method</label>
      <select id="i-method" value={method} onChange={(e) => setMethod(e.target.value as InstallmentMethod)}>
        <option value="reducing">Reducing balance</option>
        <option value="flat">Flat on the amount financed</option>
      </select>
      {result.error ? <p className="auth-message" role="alert">{result.error}</p> : null}
      {result.plan ? (
        <>
          <p>
            Financed {money(result.plan.financedMinor, currency)} · interest {money(result.plan.totalInterestMinor, currency)} ·{" "}
            <strong>total payable {money(result.plan.totalPayableMinor + toMinor(deposit || "0", currency), currency)}</strong>{" "}
            including the deposit
          </p>
          <div className="table-scroll">
            <table>
              <thead>
                <tr><th>#</th><th>Payment</th><th>Principal</th><th>Interest</th><th>Balance</th></tr>
              </thead>
              <tbody>
                {result.plan.rows.map((r) => (
                  <tr key={r.number}>
                    <td>{r.number}</td>
                    <td>{money(r.paymentMinor, currency)}</td>
                    <td>{money(r.principalMinor, currency)}</td>
                    <td>{money(r.interestMinor, currency)}</td>
                    <td>{money(r.balanceMinor, currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </section>
  );
}
