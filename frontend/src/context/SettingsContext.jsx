import { createContext, useContext, useEffect, useState } from "react";

const SettingsContext = createContext({});

export function SettingsProvider({ children }) {
  const [settings, setSettings] = useState({
    site_name:      "Heart Center",
    site_subtitle:  "Home Page",
    hero_title:     "Welcome to the Heart Center Staff Portal",
    hero_subtitle:  "Access company announcements, weekly schedules, policies, staff resources, HR documents, and internal support tools from one central location.",
    active_theme:   "default",
    banner_enabled: "0",
    banner_text:    "",
    banner_color:   "info",
  });

  useEffect(() => {
    fetch("/api/settings")
      .then(r => r.json())
      .then(data => {
        setSettings(prev => ({ ...prev, ...data }));
        if (data.active_theme && data.active_theme !== "default") {
          document.documentElement.setAttribute("data-theme", data.active_theme);
        } else {
          document.documentElement.removeAttribute("data-theme");
        }
      })
      .catch(() => {});
  }, []);

  return (
    <SettingsContext.Provider value={settings}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  return useContext(SettingsContext);
}
