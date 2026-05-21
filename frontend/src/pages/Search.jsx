import { useEffect, useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { search } from "../services/api";

function Section({ title, children, count }) {
  if (count === 0) return null;
  return (
    <div className="search-section">
      <h3 className="search-section-title">{title} <span className="search-count">{count}</span></h3>
      {children}
    </div>
  );
}

function Search() {
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState(params.get("q") || "");
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const q = params.get("q") || "";
    setQuery(q);
    if (!q.trim()) { setResults(null); return; }
    setLoading(true);
    search(q)
      .then(setResults)
      .catch(() => setResults(null))
      .finally(() => setLoading(false));
  }, [params]);

  function handleSubmit(e) {
    e.preventDefault();
    if (query.trim()) setParams({ q: query.trim() });
  }

  const total = results
    ? results.posts.length + results.resources.length + results.schedules.length + results.directory.length
    : 0;

  return (
    <>
      <header className="page-header">
        <div>
          <h2>Search</h2>
          <p>Search across announcements, resources, schedules, and staff directory.</p>
        </div>
      </header>

      <form onSubmit={handleSubmit} className="search-bar-row">
        <input
          className="search-main-input"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search the intranet..."
          autoFocus
        />
        <button type="submit" className="green-btn" style={{ marginTop: 0 }}>Search</button>
      </form>

      {loading && <div className="card" style={{ marginTop: 24 }}>Searching...</div>}

      {!loading && results && total === 0 && (
        <div className="card" style={{ marginTop: 24 }}>
          No results found for <strong>"{params.get("q")}"</strong>. Try a different keyword.
        </div>
      )}

      {!loading && results && total > 0 && (
        <div className="search-results">
          <Section title="Announcements" count={results.posts.length}>
            {results.posts.map(p => (
              <Link to="/announcements" key={p.id} className="search-result-item">
                <h4>{p.title}</h4>
                <p>{p.content?.slice(0, 140)}{p.content?.length > 140 ? "…" : ""}</p>
              </Link>
            ))}
          </Section>

          <Section title="Staff Directory" count={results.directory.length}>
            {results.directory.map(c => (
              <div key={c.id} className="search-result-item">
                <h4>{c.name}</h4>
                <p>{c.title} — {c.department} &bull; {c.phone} &bull; {c.email}</p>
              </div>
            ))}
          </Section>

          <Section title="Resources" count={results.resources.length}>
            {results.resources.map(r => (
              <a
                key={r.id}
                href={`/api/files/resources/${r.filename}`}
                download={r.original_name}
                className="search-result-item"
              >
                <h4>{r.title}</h4>
                <p>{r.category}</p>
              </a>
            ))}
          </Section>

          <Section title="Schedules" count={results.schedules.length}>
            {results.schedules.map(s => (
              <a
                key={s.id}
                href={`/api/files/schedules/${s.filename}`}
                download={s.original_name}
                className="search-result-item"
              >
                <h4>{s.title}</h4>
                <p>{s.department}{s.week_of ? ` — Week of ${s.week_of}` : ""}</p>
              </a>
            ))}
          </Section>
        </div>
      )}

      {!loading && !results && !params.get("q") && (
        <div className="card" style={{ marginTop: 24, color: "#6b7280" }}>
          Enter a keyword above to search across the entire intranet.
        </div>
      )}
    </>
  );
}

export default Search;
