const STORAGE_KEY = "hc_nav_visits";
const MIN_VISITS  = 2;

export const LINK_META = {
  "/announcements": { label: "Announcements",  icon: "📢" },
  "/schedules":     { label: "Schedules",       icon: "📅" },
  "/resources":     { label: "Staff Resources", icon: "📁" },
  "/policies":      { label: "Policies",        icon: "📋" },
  "/directory":     { label: "Directory",       icon: "📞" },
  "/it-support":    { label: "IT Support",      icon: "🖥️"  },
  "/signup-sheets": { label: "Sign-Up Sheets",  icon: "✍️"  },
  "/web-apps":      { label: "Web Applications", icon: "🌐" },
};

function getVisits() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"); }
  catch { return {}; }
}

export function recordVisit(path) {
  if (!LINK_META[path]) return;
  try {
    const visits = getVisits();
    visits[path] = (visits[path] || 0) + 1;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(visits));
  } catch (_) {}
}

export function useFrequentLinks(topN = 4) {
  const visits = getVisits();
  return Object.entries(visits)
    .filter(([path, count]) => count >= MIN_VISITS && LINK_META[path])
    .sort(([, a], [, b]) => b - a)
    .slice(0, topN)
    .map(([path]) => ({ path, ...LINK_META[path] }));
}
