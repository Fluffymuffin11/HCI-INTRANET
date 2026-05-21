function HR() {
  return (
    <>
      <header className="page-header">
        <h2>HR Resources</h2>
        <p>Employee forms, benefits information, onboarding, and HR contacts.</p>
      </header>

      <section className="dashboard-grid">
        <div className="card">
          <h3>Benefits</h3>
          <p>Access benefits documents, enrollment information, and plan resources.</p>
        </div>

        <div className="card">
          <h3>Forms</h3>
          <p>Common HR forms, requests, and internal employee documents.</p>
        </div>

        <div className="card">
          <h3>Onboarding</h3>
          <p>New employee orientation, training, and onboarding resources.</p>
        </div>
      </section>
    </>
  );
}

export default HR;
