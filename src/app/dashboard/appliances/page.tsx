"use client";

import { useState, type FormEvent } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { CompanyPage, ConfiguredOnly, errorMessage } from "../workspace";

function AddAppliance({ tenantId }: { tenantId: Id<"tenants"> }) {
  const create = useMutation(api.appliances.createAppliance);
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [power, setPower] = useState("");
  const [surge, setSurge] = useState("");
  const [pf, setPf] = useState("");
  const [hours, setHours] = useState("");
  const [currentType, setCurrentType] = useState<"ac" | "dc">("ac");
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setNotice(null);
    try {
      await create({
        tenantId,
        name,
        category,
        powerW: Number(power),
        surgeW: surge ? Number(surge) : undefined,
        powerFactor: pf ? Number(pf) : undefined,
        typicalHoursPerDay: Number(hours),
        currentType
      });
      setNotice({ ok: true, text: "Appliance added." });
      setName("");
      setPower("");
      setSurge("");
      setPf("");
      setHours("");
    } catch (error) {
      setNotice({ ok: false, text: errorMessage(error) });
    }
  }

  return (
    <form className="panel-form" onSubmit={submit}>
      <h2>Add an appliance</h2>
      <label htmlFor="ap-name">Name</label>
      <input id="ap-name" required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
      <label htmlFor="ap-cat">Category</label>
      <input id="ap-cat" required maxLength={40} value={category} onChange={(e) => setCategory(e.target.value)} />
      <label htmlFor="ap-power">Running power (W)</label>
      <input id="ap-power" required inputMode="decimal" value={power} onChange={(e) => setPower(e.target.value)} />
      <label htmlFor="ap-surge">Starting power (W, optional)</label>
      <input id="ap-surge" inputMode="decimal" value={surge} onChange={(e) => setSurge(e.target.value)} />
      <label htmlFor="ap-pf">Power factor (0–1, optional)</label>
      <input id="ap-pf" inputMode="decimal" value={pf} onChange={(e) => setPf(e.target.value)} />
      <label htmlFor="ap-hours">Typical hours per day</label>
      <input id="ap-hours" required inputMode="decimal" value={hours} onChange={(e) => setHours(e.target.value)} />
      <label htmlFor="ap-type">Supply</label>
      <select id="ap-type" value={currentType} onChange={(e) => setCurrentType(e.target.value as "ac" | "dc")}>
        <option value="ac">AC</option>
        <option value="dc">DC</option>
      </select>
      {notice ? (
        <p className={notice.ok ? "form-success" : "auth-message"} role="status">{notice.text}</p>
      ) : null}
      <button className="button" type="submit">Add appliance</button>
    </form>
  );
}

function Library({ tenantId }: { tenantId: Id<"tenants"> }) {
  const data = useQuery(api.appliances.listAppliances, { tenantId });
  const loadStandard = useMutation(api.appliances.loadStandardAppliances);
  const update = useMutation(api.appliances.updateAppliance);
  const [message, setMessage] = useState("");

  if (!data) return <p className="muted">Loading appliances…</p>;

  return (
    <>
      <p className="hint">
        Library values are typical estimates for discussion. Replace them with nameplate or measured
        values in the assessment whenever you can.
      </p>
      {data.canManage ? (
        <>
          <div className="record-actions">
            <button
              type="button"
              className="button button-secondary"
              onClick={async () => {
                try {
                  const { added } = await loadStandard({ tenantId });
                  setMessage(added ? `${added} standard appliances added.` : "The standard library is already loaded.");
                } catch (e) {
                  setMessage(errorMessage(e));
                }
              }}
            >
              Load standard appliances
            </button>
          </div>
          {message ? <p className="form-success" role="status">{message}</p> : null}
          <AddAppliance tenantId={tenantId} />
        </>
      ) : null}
      <section aria-labelledby="ap-heading" className="workspace-section">
        <h2 id="ap-heading">Appliances ({data.appliances.length})</h2>
        {data.appliances.length === 0 ? (
          <p className="muted">The library is empty.</p>
        ) : (
          <ul className="record-list">
            {data.appliances.map((a) => (
              <li className="record-card" key={a.id}>
                <div>
                  <span className="record-title">{a.name} <span className="record-code">{a.category}</span></span>
                  <span className="record-meta">
                    {a.powerW} W {a.currentType.toUpperCase()}
                    {a.surgeW ? ` · starts at ${a.surgeW} W` : ""}
                    {a.powerFactor ? ` · PF ${a.powerFactor}` : ""} · about {a.typicalHoursPerDay} h/day
                  </span>
                  {a.status === "archived" ? <span className="pill pill-warn">archived</span> : null}
                </div>
                {data.canManage ? (
                  <div className="record-actions">
                    <button
                      type="button"
                      className="button button-secondary button-small"
                      onClick={async () => {
                        try {
                          await update({
                            applianceId: a.id,
                            name: a.name,
                            category: a.category,
                            powerW: a.powerW,
                            surgeW: a.surgeW ?? undefined,
                            powerFactor: a.powerFactor ?? undefined,
                            typicalHoursPerDay: a.typicalHoursPerDay,
                            currentType: a.currentType,
                            status: a.status === "active" ? "archived" : "active"
                          });
                        } catch (e) {
                          setMessage(errorMessage(e));
                        }
                      }}
                    >
                      {a.status === "active" ? "Archive" : "Restore"}
                    </button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

export default function AppliancesPage() {
  return (
    <ConfiguredOnly>
      <CompanyPage title="Appliance library" allowedRoles={["super_admin", "sales_manager", "sales_agent", "technician"]}>
        {(company) => <Library tenantId={company.tenantId} />}
      </CompanyPage>
    </ConfiguredOnly>
  );
}
