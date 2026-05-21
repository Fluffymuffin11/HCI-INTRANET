import { useState } from "react";

const PRIORITIES = ["low", "normal", "high", "urgent"];
const PRIORITY_COLORS = { low: "#6b7280", normal: "#2563eb", high: "#d97706", urgent: "#dc2626" };
const EQUIPMENT_TYPES = ["computer", "monitor", "keyboard", "mouse", "printer", "phone", "other"];

const inputStyle = { width: "100%", padding: "8px 12px", border: "1px solid #d1d5db", borderRadius: 8, fontSize: 14, boxSizing: "border-box", fontFamily: "inherit" };
const labelStyle = { display: "block", fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 4 };
const rowStyle = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 };

function SuccessBanner({ type, onReset }) {
  return (
    <div style={{ background: "#dcfce7", borderRadius: 12, padding: "24px 28px", textAlign: "center" }}>
      <div style={{ fontSize: 36, marginBottom: 8 }}>&#10003;</div>
      <h3 style={{ margin: "0 0 6px", color: "#15803d" }}>Request Sent to IT</h3>
      <p style={{ margin: "0 0 4px", color: "#374151", fontSize: 14 }}>
        Your {type === "support" ? "support request" : "equipment request"} has been emailed to the IT team at InfoTech@theheartcenter.md.
      </p>
      <p style={{ margin: "0 0 16px", color: "#6b7280", fontSize: 13 }}>
        Someone will follow up with you soon.
      </p>
      <button onClick={onReset}
        style={{ padding: "8px 22px", background: "var(--brand)", color: "white", border: "none", borderRadius: 8, fontWeight: 600, cursor: "pointer", fontSize: 14 }}>
        Submit Another Request
      </button>
    </div>
  );
}

function PrioritySelector({ value, onChange }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={labelStyle}>Priority</label>
      <div style={{ display: "flex", gap: 8 }}>
        {PRIORITIES.map(p => (
          <button key={p} type="button" onClick={() => onChange(p)}
            style={{
              flex: 1, padding: "7px 0", border: `2px solid ${value === p ? PRIORITY_COLORS[p] : "#d1d5db"}`,
              borderRadius: 8, background: value === p ? PRIORITY_COLORS[p] + "18" : "white",
              color: value === p ? PRIORITY_COLORS[p] : "#6b7280",
              fontWeight: value === p ? 700 : 500, fontSize: 13, cursor: "pointer", textTransform: "capitalize",
            }}>
            {p}
          </button>
        ))}
      </div>
    </div>
  );
}

function SupportForm({ onSuccess }) {
  const empty = { name: "", department: "", phone: "", subject: "", description: "", priority: "normal" };
  const [form, setForm] = useState(empty);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  function set(field) { return e => setForm(f => ({ ...f, [field]: e.target.value })); }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(""); setSubmitting(true);
    try {
      const res = await fetch("/api/it-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ ...form, ticket_type: "support" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Submission failed");
      onSuccess("support");
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <div style={rowStyle}>
        <div>
          <label style={labelStyle}>Your Name *</label>
          <input style={inputStyle} value={form.name} onChange={set("name")} required placeholder="First and last name" />
        </div>
        <div>
          <label style={labelStyle}>Department</label>
          <input style={inputStyle} value={form.department} onChange={set("department")} placeholder="e.g. Cardiology, Nursing" />
        </div>
      </div>
      <div style={{ marginBottom: 14 }}>
        <label style={labelStyle}>Phone / Extension <span style={{ fontWeight: 400, color: "#9ca3af" }}>(optional)</span></label>
        <input style={inputStyle} value={form.phone} onChange={set("phone")} placeholder="Best number to reach you" />
      </div>
      <div style={{ marginBottom: 14 }}>
        <label style={labelStyle}>Subject *</label>
        <input style={inputStyle} value={form.subject} onChange={set("subject")} required placeholder="Brief description of the issue" />
      </div>
      <div style={{ marginBottom: 14 }}>
        <label style={labelStyle}>
          Description *
          <span style={{ fontWeight: 400, color: "#9ca3af", marginLeft: 6 }}>{form.description.length}/1000</span>
        </label>
        <textarea style={{ ...inputStyle, resize: "vertical", minHeight: 110 }}
          value={form.description} onChange={set("description")} required maxLength={1000}
          placeholder="Describe the issue in detail — what happened, what you were doing, any error messages..." />
      </div>
      <PrioritySelector value={form.priority} onChange={p => setForm(f => ({ ...f, priority: p }))} />
      {error && <p style={{ color: "#dc2626", fontSize: 13, marginBottom: 10 }}>{error}</p>}
      <button type="submit" disabled={submitting}
        style={{ padding: "10px 28px", background: "var(--brand)", color: "white", border: "none", borderRadius: 8, fontWeight: 600, fontSize: 14, cursor: submitting ? "not-allowed" : "pointer", opacity: submitting ? 0.7 : 1 }}>
        {submitting ? "Submitting..." : "Submit Request"}
      </button>
    </form>
  );
}

function EquipmentForm({ onSuccess }) {
  const empty = { name: "", department: "", phone: "", equipment_type: "", equipment_detail: "", description: "", priority: "normal" };
  const [form, setForm] = useState(empty);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  function set(field) { return e => setForm(f => ({ ...f, [field]: e.target.value })); }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.equipment_type) { setError("Please select an equipment type."); return; }
    setError(""); setSubmitting(true);
    try {
      const res = await fetch("/api/it-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ ...form, ticket_type: "equipment", subject: `Equipment request: ${form.equipment_type}` }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Submission failed");
      onSuccess("equipment");
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <div style={rowStyle}>
        <div>
          <label style={labelStyle}>Your Name *</label>
          <input style={inputStyle} value={form.name} onChange={set("name")} required placeholder="First and last name" />
        </div>
        <div>
          <label style={labelStyle}>Department</label>
          <input style={inputStyle} value={form.department} onChange={set("department")} placeholder="e.g. Cardiology, Nursing" />
        </div>
      </div>
      <div style={{ marginBottom: 14 }}>
        <label style={labelStyle}>Phone / Extension <span style={{ fontWeight: 400, color: "#9ca3af" }}>(optional)</span></label>
        <input style={inputStyle} value={form.phone} onChange={set("phone")} placeholder="Best number to reach you" />
      </div>
      <div style={{ marginBottom: 14 }}>
        <label style={labelStyle}>Equipment Type *</label>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {EQUIPMENT_TYPES.map(t => (
            <button key={t} type="button" onClick={() => setForm(f => ({ ...f, equipment_type: t }))}
              style={{
                padding: "6px 14px", border: `2px solid ${form.equipment_type === t ? "var(--brand)" : "#d1d5db"}`,
                borderRadius: 20, background: form.equipment_type === t ? "var(--brand)" : "white",
                color: form.equipment_type === t ? "white" : "#374151",
                fontWeight: 600, fontSize: 13, cursor: "pointer", textTransform: "capitalize",
              }}>
              {t}
            </button>
          ))}
        </div>
      </div>
      <div style={{ marginBottom: 14 }}>
        <label style={labelStyle}>Specific Model / Details <span style={{ fontWeight: 400, color: "#9ca3af" }}>(optional)</span></label>
        <input style={inputStyle} value={form.equipment_detail} onChange={set("equipment_detail")} placeholder="e.g. Dell 27&quot; monitor, HP LaserJet M404" />
      </div>
      <div style={{ marginBottom: 14 }}>
        <label style={labelStyle}>
          Description / Justification *
          <span style={{ fontWeight: 400, color: "#9ca3af", marginLeft: 6 }}>{form.description.length}/1000</span>
        </label>
        <textarea style={{ ...inputStyle, resize: "vertical", minHeight: 90 }}
          value={form.description} onChange={set("description")} required maxLength={1000}
          placeholder="Explain what you need and why — e.g. replacement for broken device, new workstation for new hire..." />
      </div>
      <PrioritySelector value={form.priority} onChange={p => setForm(f => ({ ...f, priority: p }))} />
      {error && <p style={{ color: "#dc2626", fontSize: 13, marginBottom: 10 }}>{error}</p>}
      <button type="submit" disabled={submitting}
        style={{ padding: "10px 28px", background: "var(--brand)", color: "white", border: "none", borderRadius: 8, fontWeight: 600, fontSize: 14, cursor: submitting ? "not-allowed" : "pointer", opacity: submitting ? 0.7 : 1 }}>
        {submitting ? "Submitting..." : "Submit Request"}
      </button>
    </form>
  );
}

function ITSupport() {
  const [tab, setTab] = useState("support");
  const [success, setSuccess] = useState(null); // "support" | "equipment" | null

  function handleSuccess(type) { setSuccess(type); }
  function handleReset() { setSuccess(null); }

  const tabs = [
    { key: "support", label: "Technical Support", desc: "Report issues, software problems, or request IT assistance" },
    { key: "equipment", label: "Equipment Request", desc: "Request hardware, devices, or workstation accessories" },
  ];

  return (
    <>
      <header className="page-header">
        <h2>IT Support</h2>
        <p>Submit a request and the IT team will follow up with you shortly. For password or account access issues, please call IT directly.</p>
      </header>

      <div style={{ display: "flex", gap: 14, marginBottom: 20 }}>
        {tabs.map(t => (
          <button key={t.key} onClick={() => { setTab(t.key); setSuccess(null); }}
            style={{
              flex: 1, padding: "16px 20px", border: `2px solid ${tab === t.key ? "var(--brand)" : "#e5e7eb"}`,
              borderRadius: 12, background: tab === t.key ? "var(--brand-light, #f0fdf4)" : "white",
              cursor: "pointer", textAlign: "left",
            }}>
            <div style={{ fontWeight: 700, fontSize: 15, color: tab === t.key ? "var(--brand-dark)" : "#111827", marginBottom: 4 }}>{t.label}</div>
            <div style={{ fontSize: 12, color: "#6b7280" }}>{t.desc}</div>
          </button>
        ))}
      </div>

      <section className="card">
        {success ? (
          <SuccessBanner type={success} onReset={handleReset} />
        ) : tab === "support" ? (
          <>
            <h3 style={{ margin: "0 0 16px", color: "var(--brand-dark)" }}>Technical Support Request</h3>
            <SupportForm onSuccess={handleSuccess} />
          </>
        ) : (
          <>
            <h3 style={{ margin: "0 0 16px", color: "var(--brand-dark)" }}>Equipment Request</h3>
            <EquipmentForm onSuccess={handleSuccess} />
          </>
        )}
      </section>

      <div className="card" style={{ marginTop: 14, background: "#fef9c3", border: "1px solid #fde047" }}>
        <p style={{ margin: 0, fontSize: 13, color: "#713f12" }}>
          <strong>Password or account access issues?</strong> Please call the IT Help Desk directly — do not submit a ticket for these. Account lockouts can be resolved faster over the phone.
        </p>
      </div>
    </>
  );
}

export default ITSupport;
