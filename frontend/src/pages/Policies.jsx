function Policies() {
  return (
    <>
      <header className="page-header">
        <h2>Policies</h2>
        <p>Company policies, procedures, compliance documents, and references.</p>
      </header>

      <section className="dashboard-grid">
        <div className="card">
          <h3>Employee Policies</h3>
          <p>Handbook, conduct, attendance, and internal guidelines.</p>
        </div>

        <div className="card">
          <h3>Clinical / Operational Policies</h3>
          <p>Department procedures, workflow documentation, and internal standards.</p>
        </div>

        <div className="card">
          <h3>Compliance</h3>
          <p>Privacy, security, regulatory, and documentation standards.</p>
        </div>
      </section>
    </>
  );
}

export default Policies;
