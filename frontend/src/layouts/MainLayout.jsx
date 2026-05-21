import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useEffect } from "react";
import { useSettings } from "../context/SettingsContext";
import { recordVisit } from "../hooks/useFrequentLinks";

function MainLayout() {
  const settings = useSettings();
  const location = useLocation();

  useEffect(() => {
    recordVisit(location.pathname);
  }, [location.pathname]);

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div style={{ width: 52, height: 52, background: "white", borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, boxShadow: "0 2px 8px rgba(0,0,0,0.15)" }}>
            <img src="/logo.png" alt="Heart Center" style={{ width: 44, height: 44, objectFit: "contain" }} onError={e => { e.target.style.display = "none"; }} />
          </div>
          <div>
            <h1>{settings.site_name || "Heart Center"}</h1>
            <p>{settings.site_subtitle || "Home Page"}</p>
          </div>
        </div>

        <nav>
          <NavLink to="/" end>Home</NavLink>
          <NavLink to="/announcements">Announcements</NavLink>
          <NavLink to="/schedules">Schedules</NavLink>
          <NavLink to="/resources">Staff Resources</NavLink>
          <NavLink to="/policies">Policies</NavLink>
          <NavLink to="/directory">Directory</NavLink>
          <NavLink to="/it-support">IT Support</NavLink>
          <NavLink to="/signup-sheets">Sign-Up Sheets</NavLink>
          <NavLink to="/web-apps">Web Applications</NavLink>
          <a href="/admin/login.html">Admin Portal</a>
        </nav>
      </aside>

      <main className="main-content">
        <Outlet />
      </main>
    </div>
  );
}

export default MainLayout;
