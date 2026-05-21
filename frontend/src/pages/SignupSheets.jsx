import { useEffect, useState } from "react";
import { getSignupSheets, getSignupSheet, signupForSheet } from "../services/api";

const DAY_LABELS = { mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday", sun: "Sunday" };
const PATTERN_LABELS = { daily: "Daily", weekly: "Weekly", biweekly: "Every 2 Weeks", monthly: "Monthly" };

function fmtDay(str) {
  if (!str) return "";
  const s = str.length === 10 ? str + "T12:00:00" : str;
  return new Date(s).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "America/Chicago" });
}

function fmtDeadline(str) {
  if (!str) return null;
  return new Date(str.endsWith("Z") ? str : str + "Z").toLocaleString("en-US", {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "America/Chicago",
  });
}

function eventDateLabel(sheet) {
  const { event_type, event_date, end_date, recurrence_pattern, recurrence_days, recurrence_end_date } = sheet;
  if (event_type === "multiday" && event_date && end_date) {
    return `📅 ${fmtDay(event_date)} – ${fmtDay(end_date)}`;
  }
  if (event_type === "recurring" && recurrence_pattern) {
    const days = recurrence_days ? recurrence_days.split(",").map(d => DAY_LABELS[d] || d).join(" & ") : "";
    const pattern = PATTERN_LABELS[recurrence_pattern] || recurrence_pattern;
    const start = event_date ? ` starting ${fmtDay(event_date)}` : "";
    const end   = recurrence_end_date ? ` through ${fmtDay(recurrence_end_date)}` : "";
    return `🔁 ${pattern}${days ? " on " + days : ""}${start}${end}`;
  }
  if (event_date) return `📅 ${fmtDay(event_date)}`;
  return null;
}

function SlotBar({ filled, max }) {
  if (!max) return null;
  const pct = Math.min(100, Math.round((filled / max) * 100));
  const color = pct >= 100 ? "#dc2626" : pct >= 75 ? "#d97706" : "var(--brand)";
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#6b7280", marginBottom: 4 }}>
        <span>{filled} of {max} spots filled</span>
        <span>{Math.max(0, max - filled)} remaining</span>
      </div>
      <div style={{ background: "#e5e7eb", borderRadius: 6, height: 8 }}>
        <div style={{ width: `${pct}%`, background: color, borderRadius: 6, height: 8, transition: "width 0.3s" }} />
      </div>
    </div>
  );
}

function SignupModal({ sheet: initial, onClose, onSuccess }) {
  const [sheet, setSheet] = useState(initial);
  const [name, setName] = useState("");
  const [department, setDepartment] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [waitlisted, setWaitlisted] = useState(false);

  useEffect(() => { getSignupSheet(initial.id).then(setSheet).catch(() => {}); }, [initial.id]);

  const isFull = sheet.max_slots > 0 && sheet.filled_slots >= sheet.max_slots;
  const deadlinePassed = sheet.deadline && new Date() > new Date(sheet.deadline.endsWith("Z") ? sheet.deadline : sheet.deadline + "Z");
  const dateLabel = eventDateLabel(sheet);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(""); setSubmitting(true);
    try {
      const result = await signupForSheet(sheet.id, { name, department, notes });
      setWaitlisted(result.waitlisted);
      setDone(true);
      onSuccess?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background: "white", borderRadius: 16, width: "100%", maxWidth: 500, padding: 28, boxShadow: "0 20px 60px rgba(0,0,0,0.2)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
          <div>
            <h3 style={{ margin: 0, color: "var(--brand-dark)", fontSize: 18 }}>{sheet.title}</h3>
            {dateLabel && <p style={{ margin: "4px 0 0", color: "#6b7280", fontSize: 13 }}>{dateLabel}{sheet.location ? ` · 📍 ${sheet.location}` : ""}</p>}
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "#9ca3af", lineHeight: 1 }}>×</button>
        </div>

        {sheet.description && <p style={{ color: "#374151", fontSize: 14, marginBottom: 12, lineHeight: 1.6 }}>{sheet.description}</p>}
        <SlotBar filled={sheet.filled_slots || 0} max={sheet.max_slots} />
        {sheet.allow_waitlist && isFull && <p style={{ fontSize: 12, color: "#d97706", marginTop: 6 }}>Event is full — you will be added to the waitlist ({sheet.waitlist_count || 0} waiting)</p>}
        {sheet.deadline && <p style={{ fontSize: 12, color: "#6b7280", marginTop: 6 }}>Sign-up deadline: {fmtDeadline(sheet.deadline)}</p>}

        {done ? (
          <div style={{ marginTop: 20, padding: 16, background: waitlisted ? "#fef3c7" : "#dcfce7", borderRadius: 10, textAlign: "center" }}>
            <div style={{ fontSize: 28 }}>{waitlisted ? "⏳" : "✅"}</div>
            <p style={{ margin: "8px 0 0", fontWeight: 600, color: waitlisted ? "#92400e" : "#15803d" }}>
              {waitlisted ? "You've been added to the waitlist!" : "You're signed up!"}
            </p>
            <button onClick={onClose} style={{ marginTop: 12, padding: "8px 20px", background: "var(--brand)", color: "white", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600 }}>Close</button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={{ marginTop: 16 }}>
            {(!isFull || sheet.allow_waitlist) && !deadlinePassed && sheet.is_open ? (
              <>
                {[["Your Name *", "name", "text", name, setName, "First and last name", true],
                  ["Department", "dept", "text", department, setDepartment, "e.g. Nursing, Cardiology", false]].map(([label, , type, val, setter, placeholder, required]) => (
                  <div key={label} style={{ marginBottom: 12 }}>
                    <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 4 }}>{label}</label>
                    <input value={val} onChange={e => setter(e.target.value)} required={required} placeholder={placeholder} type={type}
                      style={{ width: "100%", padding: "8px 12px", border: "1px solid #d1d5db", borderRadius: 8, fontSize: 14, boxSizing: "border-box" }} />
                  </div>
                ))}
                <div style={{ marginBottom: 16 }}>
                  <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 4 }}>Notes <span style={{ fontWeight: 400, color: "#9ca3af" }}>(optional)</span></label>
                  <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder="Any special requests or notes"
                    style={{ width: "100%", padding: "8px 12px", border: "1px solid #d1d5db", borderRadius: 8, fontSize: 14, resize: "vertical", boxSizing: "border-box" }} />
                </div>
                {error && <p style={{ color: "#dc2626", fontSize: 13, marginBottom: 10 }}>{error}</p>}
                <button type="submit" disabled={submitting}
                  style={{ width: "100%", padding: 10, background: "var(--brand)", color: "white", border: "none", borderRadius: 8, fontWeight: 600, fontSize: 15, cursor: submitting ? "not-allowed" : "pointer", opacity: submitting ? 0.7 : 1 }}>
                  {submitting ? "Signing up..." : isFull ? "Join Waitlist" : "Sign Up"}
                </button>
              </>
            ) : (
              <div style={{ padding: 16, background: "#fee2e2", borderRadius: 10, textAlign: "center", marginTop: 8 }}>
                <p style={{ margin: 0, color: "#991b1b", fontWeight: 600 }}>
                  {!sheet.is_open ? "This sign-up sheet is closed." : deadlinePassed ? "The sign-up deadline has passed." : "This event is full and has no waitlist."}
                </p>
              </div>
            )}
          </form>
        )}
      </div>
    </div>
  );
}

function TypeBadge({ type }) {
  const map = { single: ["#dbeafe", "#1e40af", "Single Day"], multiday: ["#ede9fe", "#6d28d9", "Multi-Day"], recurring: ["#fef3c7", "#92400e", "Recurring"] };
  const [bg, color, label] = map[type] || map.single;
  return <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 20, background: bg, color, letterSpacing: "0.4px" }}>{label}</span>;
}

function SheetCard({ sheet, onSignup }) {
  const [showModal, setShowModal] = useState(false);
  const isFull = sheet.max_slots > 0 && sheet.filled_slots >= sheet.max_slots;
  const isClosed = !sheet.is_open;
  const deadlinePassed = sheet.deadline && new Date() > new Date(sheet.deadline.endsWith("Z") ? sheet.deadline : sheet.deadline + "Z");
  const unavailable = isClosed || deadlinePassed || (isFull && !sheet.allow_waitlist);
  const dateLabel = eventDateLabel(sheet);

  const statusColor = isClosed ? "#6b7280" : isFull ? "#dc2626" : "#15803d";
  const statusText = isClosed ? "Closed" : deadlinePassed ? "Deadline Passed" : isFull ? (sheet.allow_waitlist ? "Waitlist Open" : "Full") : "Open";

  return (
    <>
      <div className="card" style={{ marginBottom: 14, cursor: unavailable ? "default" : "pointer" }} onClick={() => !unavailable && setShowModal(true)}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
          <div style={{ flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
              <h4 style={{ margin: 0, color: "var(--brand-dark)", fontSize: 16 }}>{sheet.title}</h4>
              <TypeBadge type={sheet.event_type} />
              <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 20, background: statusColor + "20", color: statusColor, textTransform: "uppercase" }}>{statusText}</span>
            </div>
            {dateLabel && <p style={{ margin: "4px 0 0", color: "#6b7280", fontSize: 13 }}>{dateLabel}{sheet.location ? ` · 📍 ${sheet.location}` : ""}</p>}
            {sheet.description && <p style={{ margin: "6px 0 0", color: "#374151", fontSize: 14, lineHeight: 1.5 }}>{sheet.description}</p>}
            <SlotBar filled={sheet.filled_slots || 0} max={sheet.max_slots} />
            {sheet.deadline && <p style={{ margin: "6px 0 0", fontSize: 12, color: "#6b7280" }}>Sign-up deadline: {fmtDeadline(sheet.deadline)}</p>}
          </div>
          {!unavailable && (
            <button style={{ flexShrink: 0, padding: "8px 16px", background: "var(--brand)", color: "white", border: "none", borderRadius: 8, fontWeight: 600, cursor: "pointer", fontSize: 13 }}>
              {isFull && sheet.allow_waitlist ? "Join Waitlist" : "Sign Up"}
            </button>
          )}
        </div>
      </div>
      {showModal && <SignupModal sheet={sheet} onClose={() => setShowModal(false)} onSuccess={() => { setShowModal(false); onSignup?.(); }} />}
    </>
  );
}

function SignupSheets() {
  const [sheets, setSheets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("open");
  const [typeFilter, setTypeFilter] = useState("all");

  function load() {
    getSignupSheets().then(data => { setSheets(data); setLoading(false); }).catch(() => setLoading(false));
  }
  useEffect(() => { load(); }, []);

  const filtered = sheets.filter(s => {
    const statusOk = filter === "all" ? true : filter === "open" ? s.is_open : !s.is_open;
    const typeOk = typeFilter === "all" ? true : s.event_type === typeFilter;
    return statusOk && typeOk;
  });

  return (
    <>
      <header className="topbar">
        <div>
          <h2>Sign-Up Sheets</h2>
          <p>Register for classes, events, and training sessions</p>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {["all", "open", "closed"].map(f => (
            <button key={f} onClick={() => setFilter(f)}
              style={{ padding: "6px 14px", border: "1px solid var(--brand)", borderRadius: 20, background: filter === f ? "var(--brand)" : "white", color: filter === f ? "white" : "var(--brand)", cursor: "pointer", fontWeight: 600, fontSize: 12, textTransform: "capitalize" }}>
              {f}
            </button>
          ))}
          <span style={{ width: 1, background: "#e5e7eb", margin: "0 2px" }} />
          {[["all", "All Types"], ["single", "Single Day"], ["multiday", "Multi-Day"], ["recurring", "Recurring"]].map(([f, label]) => (
            <button key={f} onClick={() => setTypeFilter(f)}
              style={{ padding: "6px 14px", border: "1px solid #d1d5db", borderRadius: 20, background: typeFilter === f ? "#374151" : "white", color: typeFilter === f ? "white" : "#374151", cursor: "pointer", fontWeight: 600, fontSize: 12 }}>
              {label}
            </button>
          ))}
        </div>
      </header>

      <div style={{ padding: "24px 32px" }}>
        {loading ? (
          <div className="card">Loading sign-up sheets...</div>
        ) : filtered.length === 0 ? (
          <div className="card" style={{ textAlign: "center", padding: 40, color: "#6b7280" }}>
            <div style={{ fontSize: 40, marginBottom: 8 }}>📋</div>
            <p>No matching sign-up sheets found.</p>
          </div>
        ) : (
          filtered.map(sheet => <SheetCard key={sheet.id} sheet={sheet} onSignup={load} />)
        )}
      </div>
    </>
  );
}

export default SignupSheets;
