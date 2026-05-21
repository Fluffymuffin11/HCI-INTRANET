import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { getPosts } from "../services/api";
import AnnouncementCard from "../components/AnnouncementCard";
import EmployeeSpotlight from "../components/EmployeeSpotlight";
import { useSettings } from "../context/SettingsContext";
import { useFrequentLinks } from "../hooks/useFrequentLinks";

function Home() {
  const navigate = useNavigate();
  const settings = useSettings();
  const frequentLinks = useFrequentLinks(4);
  const [posts, setPosts] = useState([]);
  const [loadingPosts, setLoadingPosts] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    async function loadPosts() {
      try {
        const data = await getPosts();
        setPosts(data);
      } catch (err) {
        console.error(err);
      } finally {
        setLoadingPosts(false);
      }
    }

    loadPosts();
  }, []);

  return (
    <>
      <header className="topbar">
        <div>
          <h2>Heart Center Home Page</h2>
          <p>Resources, schedules, announcements, and internal information</p>
        </div>

        <div className="top-actions">
          <form
            onSubmit={e => {
              e.preventDefault();
              if (searchQuery.trim()) navigate(`/search?q=${encodeURIComponent(searchQuery.trim())}`);
            }}
          >
            <input
              placeholder="Search the intranet..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
          </form>

          {frequentLinks.length > 0 && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8, justifyContent: "flex-end" }}>
              <span style={{ fontSize: 11, color: "#9ca3af", alignSelf: "center", marginRight: 2, whiteSpace: "nowrap" }}>Your top pages:</span>
              {frequentLinks.map(link => (
                <Link
                  key={link.path}
                  to={link.path}
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 4,
                    padding: "4px 10px", borderRadius: 20,
                    background: "rgba(255,255,255,0.15)", backdropFilter: "blur(4px)",
                    color: "var(--brand-dark, #0f5132)", fontSize: 12, fontWeight: 600,
                    textDecoration: "none", border: "1px solid rgba(15,81,50,0.15)",
                    whiteSpace: "nowrap", transition: "background 0.15s",
                  }}
                  onMouseOver={e => e.currentTarget.style.background = "rgba(255,255,255,0.35)"}
                  onMouseOut={e => e.currentTarget.style.background = "rgba(255,255,255,0.15)"}
                >
                  <span>{link.icon}</span> {link.label}
                </Link>
              ))}
            </div>
          )}
        </div>
      </header>

      <section className="hero">
        <div className="hero-overlay">
          <h1>{settings.hero_title || "Welcome to the Heart Center Staff Portal"}</h1>

          <p>{settings.hero_subtitle || "Access company announcements, weekly schedules, policies, staff resources, HR documents, and internal support tools from one central location."}</p>
        </div>
      </section>

      <section className="content-layout">
        <div className="feed-column">
          <div className="section-title-row">
            <div>
              <h3>Latest Announcements</h3>
              <p>Leadership updates and internal notices</p>
            </div>

            <Link to="/announcements" className="text-link">
              View all
            </Link>
          </div>

          {loadingPosts ? (
            <div className="card">Loading announcements...</div>
          ) : posts.length === 0 ? (
            <div className="card">No announcements available.</div>
          ) : (
            posts.slice(0, 5).map((post) => (
              <AnnouncementCard key={post.id} post={post} />
            ))
          )}
        </div>

        <div className="right-column">
          <EmployeeSpotlight />

          <div className="card">
            <h3>Quick Links</h3>

            <div className="quick-link-list">
              <Link to="/resources">Employee Handbook</Link>
              <Link to="/schedules">Weekly Schedules</Link>
              <Link to="/web-apps">Web Applications</Link>
              <Link to="/it-support">IT Support Request</Link>
              <Link to="/resources">Training Resources</Link>
            </div>
          </div>

          <div className="card">
            <h3>Need Help?</h3>
            <p>
              For account access, hardware, software, or internal system
              support, contact IT or submit a request.
            </p>

            <Link className="green-btn link-button" to="/it-support">
              Open IT Support
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}

export default Home;
