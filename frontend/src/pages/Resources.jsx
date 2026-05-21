import { useEffect, useState } from "react";
import { getResources } from "../services/api";
import { getEmbedUrl } from "../utils/embedUrl";

function NominationForm() {
  const [form, setForm] = useState({ nominee_name: "", nominee_title: "", nominee_department: "", reason: "", submitted_by: "" });
  const [status, setStatus] = useState(null); // null | "success" | "error"
  const [msg, setMsg] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function set(field) { return e => setForm(f => ({ ...f, [field]: e.target.value })); }

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true); setStatus(null);
    try {
      const res = await fetch("/api/spotlight/nominations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Submission failed");
      setStatus("success");
      setMsg("Thank you! Your nomination has been submitted for review.");
      setForm({ nominee_name: "", nominee_title: "", nominee_department: "", reason: "", submitted_by: "" });
    } catch (err) {
      setStatus("error");
      setMsg(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  const inputStyle = { width: "100%", padding: "8px 12px", border: "1px solid #d1d5db", borderRadius: 8, fontSize: 14, boxSizing: "border-box", fontFamily: "inherit" };
  const labelStyle = { display: "block", fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 4 };

  return (
    <section className="card" style={{ marginTop: 24 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 4 }}>
        <span style={{ fontSize: 28 }}>⭐</span>
        <div>
          <h3 style={{ margin: 0, color: "var(--brand-dark)" }}>Nominate an Employee for Spotlight</h3>
          <p style={{ margin: "2px 0 0", color: "#6b7280", fontSize: 13 }}>Recognize a coworker who goes above and beyond. Nominations are reviewed by leadership.</p>
        </div>
      </div>

      {status === "success" && (
        <div style={{ background: "#dcfce7", color: "#15803d", borderRadius: 10, padding: "12px 16px", marginTop: 16, fontWeight: 600, fontSize: 14 }}>
          ✅ {msg}
        </div>
      )}
      {status === "error" && (
        <div style={{ background: "#fee2e2", color: "#991b1b", borderRadius: 10, padding: "12px 16px", marginTop: 16, fontWeight: 600, fontSize: 14 }}>
          {msg}
        </div>
      )}

      {status !== "success" && (
        <form onSubmit={handleSubmit} style={{ marginTop: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
            <div>
              <label style={labelStyle}>Employee Name *</label>
              <input style={inputStyle} value={form.nominee_name} onChange={set("nominee_name")} required placeholder="First and last name" />
            </div>
            <div>
              <label style={labelStyle}>Job Title</label>
              <input style={inputStyle} value={form.nominee_title} onChange={set("nominee_title")} placeholder="e.g. RN, Patient Coordinator" />
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
            <div>
              <label style={labelStyle}>Department</label>
              <input style={inputStyle} value={form.nominee_department} onChange={set("nominee_department")} placeholder="e.g. Cardiology, Nursing" />
            </div>
            <div>
              <label style={labelStyle}>Your Name <span style={{ fontWeight: 400, color: "#9ca3af" }}>(optional)</span></label>
              <input style={inputStyle} value={form.submitted_by} onChange={set("submitted_by")} placeholder="Leave blank to submit anonymously" />
            </div>
          </div>
          <div style={{ marginBottom: 16 }}>
            <label style={labelStyle}>
              Why do you want to nominate this person? *
              <span style={{ fontWeight: 400, color: "#9ca3af", marginLeft: 6 }}>{form.reason.length}/500</span>
            </label>
            <textarea
              style={{ ...inputStyle, resize: "vertical", minHeight: 100 }}
              value={form.reason}
              onChange={set("reason")}
              required
              maxLength={500}
              placeholder="Describe how this employee has gone above and beyond, a specific moment, or their ongoing contributions..."
            />
          </div>
          <button type="submit" disabled={submitting}
            style={{ padding: "10px 24px", background: "var(--brand)", color: "white", border: "none", borderRadius: 8, fontWeight: 600, fontSize: 14, cursor: submitting ? "not-allowed" : "pointer", opacity: submitting ? 0.7 : 1 }}>
            {submitting ? "Submitting..." : "Submit Nomination"}
          </button>
        </form>
      )}
    </section>
  );
}

function Resources() {
  const [resources, setResources] = useState([]);

  useEffect(() => {
    getResources().then(setResources).catch(console.error);
  }, []);

  return (
    <>
      <header className="page-header">
        <h2>Staff Resources</h2>
        <p>Forms, documents, training materials, and internal references.</p>
      </header>

      <section className="card">
        {resources.length === 0 ? (
          <p>No resources have been uploaded yet.</p>
        ) : (
          <div className="resource-list">
            {resources.map(resource => {
              const embedUrl = getEmbedUrl(resource.video_url);
              return (
                <div key={resource.id}>
                  <div className="resource-row" style={{ alignItems: embedUrl ? "flex-start" : undefined }}>
                    <div style={{ flex: 1 }}>
                      <h4>{resource.title}</h4>
                      <p>{resource.category}</p>
                    </div>
                    {resource.filename && (
                      <a href={`/api/files/resources/${resource.filename}`} download={resource.original_name} className="green-btn" style={{ marginTop: 0, flexShrink: 0 }}>
                        Download
                      </a>
                    )}
                  </div>
                  {embedUrl && (
                    <div style={{ position: "relative", paddingBottom: "56.25%", height: 0, marginBottom: 16, borderRadius: 10, overflow: "hidden", background: "#000" }}>
                      <iframe
                        src={embedUrl}
                        title={resource.title}
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                        allowFullScreen
                        style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", border: "none" }}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <NominationForm />
    </>
  );
}

export default Resources;
