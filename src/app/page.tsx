const modules = [
  {
    number: "01",
    title: "Customer assessment",
    description: "Capture appliances, usage patterns, backup needs and site details."
  },
  {
    number: "02",
    title: "System designer",
    description: "Turn customer energy needs into a technically reviewable solar design."
  },
  {
    number: "03",
    title: "Products & inventory",
    description: "Work from administrator-managed products, specifications and stock."
  },
  {
    number: "04",
    title: "Quotations",
    description: "Create illustrative quotations and route designs to a technician for approval."
  }
];

export default function HomePage() {
  return (
    <main className="shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Lumina home">
          <span className="brand-mark">L</span>
          <span>LUMINA</span>
        </a>
        <span className="environment">PROJECT FOUNDATION</span>
      </header>

      <section className="hero">
        <p className="eyebrow">SOLAR SALES · SYSTEM DESIGN · QUOTATIONS</p>
        <h1>Build the right solar system for every customer.</h1>
        <p className="hero-copy">
          Lumina guides sales teams from customer energy assessment to a
          technically verified solar quotation, using the company&apos;s
          catalogue, pricing rules and live inventory.
        </p>
        <div className="hero-actions">
          <span className="status-dot" />
          <span>Foundation workspace ready for configuration</span>
        </div>
      </section>

      <section className="module-section" aria-labelledby="modules-heading">
        <div className="section-heading">
          <div>
            <p className="eyebrow">PLATFORM MODULES</p>
            <h2 id="modules-heading">The Lumina workflow</h2>
          </div>
          <span className="phase-label">PHASE 0</span>
        </div>
        <div className="module-grid">
          {modules.map((module) => (
            <article className="module-card" key={module.number}>
              <span className="module-number">{module.number}</span>
              <h3>{module.title}</h3>
              <p>{module.description}</p>
              <span className="module-state">Planned module</span>
            </article>
          ))}
        </div>
      </section>

      <section className="approval-note">
        <div className="approval-icon" aria-hidden="true">✓</div>
        <div>
          <h2>Technical approval is built into the workflow</h2>
          <p>
            Sales agents can share an illustrative copy marked
            &quot;UNVERIFIED — FOR ILLUSTRATION ONLY&quot;. Only an authorised
            technician can approve a design for an official quotation.
          </p>
        </div>
      </section>

      <footer className="footer">
        <span>Lumina · Solar Sales & System Intelligence</span>
        <span>Initial deployment · Uganda · Multi-currency ready</span>
      </footer>
    </main>
  );
}
