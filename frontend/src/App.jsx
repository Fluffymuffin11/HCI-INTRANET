import "./App.css";

import { BrowserRouter, Routes, Route } from "react-router-dom";
import { useState } from "react";

import { SettingsProvider, useSettings } from "./context/SettingsContext";
import MainLayout from "./layouts/MainLayout";

import Home        from "./pages/Home";
import Announcements from "./pages/Announcements";
import Schedules   from "./pages/Schedules";
import Resources   from "./pages/Resources";
import Policies    from "./pages/Policies";
import Directory   from "./pages/Directory";
import ITSupport   from "./pages/ITSupport";
import WebApps     from "./pages/WebApps";
import Search      from "./pages/Search";
import SignupSheets from "./pages/SignupSheets";

const bannerStyles = {
  info:    { background: "#dbeafe", color: "#1e40af", border: "#93c5fd" },
  warning: { background: "#fef3c7", color: "#92400e", border: "#fcd34d" },
  success: { background: "#dcfce7", color: "#15803d", border: "#86efac" },
  urgent:  { background: "#fee2e2", color: "#991b1b", border: "#fca5a5" },
};

function SiteBanner() {
  const settings = useSettings();
  const [dismissed, setDismissed] = useState(false);

  if (settings.banner_enabled !== "1" || !settings.banner_text || dismissed) return null;

  const style = bannerStyles[settings.banner_color] || bannerStyles.info;
  return (
    <div style={{
      background: style.background,
      color: style.color,
      borderBottom: `1px solid ${style.border}`,
      padding: "12px 24px",
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      fontSize: 14,
      fontWeight: 600,
      position: "sticky",
      top: 0,
      zIndex: 100,
    }}>
      <span>📢 {settings.banner_text}</span>
      <button
        onClick={() => setDismissed(true)}
        style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", fontSize: 18, lineHeight: 1, padding: "0 4px" }}
        aria-label="Dismiss"
      >×</button>
    </div>
  );
}

function AppRoutes() {
  return (
    <>
      <SiteBanner />
      <Routes>
        <Route element={<MainLayout />}>
          <Route path="/"             element={<Home />} />
          <Route path="/announcements" element={<Announcements />} />
          <Route path="/schedules"    element={<Schedules />} />
          <Route path="/resources"    element={<Resources />} />
          <Route path="/policies"     element={<Policies />} />
          <Route path="/directory"    element={<Directory />} />
          <Route path="/it-support"   element={<ITSupport />} />
          <Route path="/web-apps"     element={<WebApps />} />
          <Route path="/search"       element={<Search />} />
          <Route path="/signup-sheets" element={<SignupSheets />} />
        </Route>
      </Routes>
    </>
  );
}

function App() {
  return (
    <SettingsProvider>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </SettingsProvider>
  );
}

export default App;
