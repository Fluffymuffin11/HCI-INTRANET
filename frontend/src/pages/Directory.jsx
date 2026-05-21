import { useEffect, useState, useCallback } from "react";
import { getDirectory } from "../services/api";

function ContactRow({ contact: c }) {
  return (
    <div className="resource-row directory-row">
      <div className="directory-avatar">
        {c.name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase()}
      </div>
      <div style={{ flex: 1 }}>
        <h4 style={{ margin: "0 0 2px" }}>{c.name}</h4>
        <p style={{ margin: 0, fontSize: 13, color: "#6b7280" }}>{c.title}</p>
      </div>
      <div className="directory-contact">
        <span>{c.phone}</span>
        <a href={`mailto:${c.email}`} style={{ color: "#0f5132" }}>{c.email}</a>
      </div>
    </div>
  );
}

function Directory() {
  const [contacts, setContacts] = useState([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback((q) => {
    setLoading(true);
    getDirectory(q)
      .then(setContacts)
      .catch(() => setContacts([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(""); }, [load]);

  useEffect(() => {
    const id = setTimeout(() => load(query), 250);
    return () => clearTimeout(id);
  }, [query, load]);

  const departments = [...new Set(contacts.map(c => c.department).filter(Boolean))].sort();

  return (
    <>
      <header className="page-header">
        <div>
          <h2>Staff Directory</h2>
          <p>Find staff by name, department, extension, or email.</p>
        </div>
      </header>

      <div className="card">
        <input
          className="wide-search"
          placeholder="Search by name, department, title, phone, or email..."
          value={query}
          onChange={e => setQuery(e.target.value)}
        />

        {loading ? (
          <p style={{ color: "#6b7280" }}>Loading...</p>
        ) : contacts.length === 0 ? (
          <p style={{ color: "#6b7280" }}>No contacts found.</p>
        ) : query ? (
          <div className="resource-list">
            {contacts.map(c => <ContactRow key={c.id} contact={c} />)}
          </div>
        ) : (
          departments.map(dept => (
            <div key={dept} className="directory-dept-group">
              <h4 className="directory-dept-label">{dept}</h4>
              <div className="resource-list">
                {contacts.filter(c => c.department === dept).map(c => (
                  <ContactRow key={c.id} contact={c} />
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </>
  );
}

export default Directory;
