import { useState } from "react";

const APPS = [
  {
    category: "Communication",
    items: [
      { name: "Outlook Web Access",  desc: "Heart Center email",              url: "https://mail.theheartcenter.md/owa",                                                                    faviconDomain: "outlook.office365.com", icon: "✉️" },
      { name: "Zimbra Webmail",      desc: "HHS system webmail",              url: "https://webmail.hhsys.org/",                                                                            faviconDomain: "zimbra.com",            icon: "📬" },
      { name: "TigerConnect",        desc: "Secure clinical messaging",       url: "https://login.tigerconnect.com/app/messenger/",                                                         faviconDomain: "tigerconnect.com",      icon: "💬" },
      { name: "Vocera",              desc: "Hands-free communication system", url: "https://voceravmp.hhsys.org/",                                                                          faviconDomain: "vocera.com",            icon: "📡" },
    ],
  },
  {
    category: "Clinical & Patient",
    items: [
      { name: "Luma Health",             desc: "Patient engagement & scheduling", url: "https://next.lumahealth.io/login?returnUrl=%2F",                                                        faviconDomain: "lumahealth.io",         icon: "🏥" },
      { name: "Athena IDX",              desc: "Practice management system",      url: "https://athenaidxweb.hhad.hhsys.org/",                                                                  faviconDomain: "athenahealth.com",      icon: "⚕️" },
      { name: "Micromedex",              desc: "Clinical drug reference",         url: "https://www.micromedexsolutions.com/micromedex2/librarian",                                             faviconDomain: "merative.com",          icon: "💊" },
      { name: "RLDatix",                 desc: "Incident & risk reporting",       url: "https://rldatix.hhad.hhsys.org/RL6_Prod/Homecenter/Client/Login.aspx?ReturnUrl=%2fRL6_Prod",           faviconDomain: "rldatix.com",           icon: "📋" },
      { name: "Patient Service Centers", desc: "Patient service center locations",url: "https://www.huntsvillehospital.org/patient-service-center-locations",                                   faviconDomain: "huntsvillehospital.org",icon: "📍" },
    ],
  },
  {
    category: "Administrative & Finance",
    items: [
      { name: "Infor",               desc: "ERP & HR management system",      url: "https://infor-ltr-prd.hhad.hhsys.org/infor/",                                                           faviconDomain: "infor.com",             icon: "🏢" },
      { name: "Time & Attendance",   desc: "Workforce management (UKG)",       url: "https://time.hhsys.org/wfc/logon",                                                                      faviconDomain: "ukg.com",               icon: "⏱️" },
      { name: "Oracle Web Portal",   desc: "Oracle applications portal",       url: "http://oraweb.hhad.hhsys.org/cgi-bin/portal/portal.pl",                                                 faviconDomain: "oracle.com",            icon: "🗄️" },
      { name: "HCI Claims",          desc: "Claims management system",         url: "http://hciclaims:8080/josso/signon/login.do",                                                            faviconDomain: null,                    icon: "📑" },
      { name: "iCIMS",               desc: "Applicant tracking & recruiting",  url: "https://hhsys.icims.com/",                                                                              faviconDomain: "icims.com",             icon: "👥" },
      { name: "Fidelity",            desc: "Retirement & benefits",            url: "https://nb.fidelity.com/",                                                                              faviconDomain: "fidelity.com",          icon: "💰" },
    ],
  },
  {
    category: "Learning & Development",
    items: [
      { name: "HealthcareSource LMS", desc: "Online learning & training",     url: "https://lms.healthcaresource.com/mynetlearning/Login.aspx?ID=367&ReturnUrl=",                           faviconDomain: "healthcaresource.com",  icon: "🎓" },
      { name: "ePulse / Healthworks", desc: "Employee health & wellness",     url: "http://epulse.hhsys.org/HH_pages/Healthworks_Mockup/home.html",                                         faviconDomain: "huntsvillehospital.org",icon: "❤️" },
    ],
  },
  {
    category: "Systems & IT",
    items: [
      { name: "EPSI Portal",          desc: "EPSI applications portal",       url: "https://hh-epsi.hhad.hhsys.org/portal/index.html",                                                      faviconDomain: null,                    icon: "🖥️" },
      { name: "Agent Portal (OSCC)",  desc: "Contact center agent portal",    url: "https://oscchhm.hhad.hhsys.org/agentportal/#login",                                                     faviconDomain: null,                    icon: "🎧" },
      { name: "Mobius",               desc: "Mobius production system",       url: "https://mobiusprd.hhad.hhsys.org:8443/mobius/view/#/staging",                                           faviconDomain: null,                    icon: "🔄" },
      { name: "Web Assistant",        desc: "Internal web assistant tool",    url: "https://10.144.160.30/cgi_bin/webassistant/login",                                                       faviconDomain: null,                    icon: "🛠️" },
      { name: "GPMS Web (Test)",       desc: "GPMS test environment",          url: "http://10.220.3.82/gpmswebnui/index.html",                                                               faviconDomain: "gevernova.com",         icon: "📊" },
      { name: "GPMS Web (New)",        desc: "GPMS new environment",           url: "http://10.220.3.130/gpmswebnui/index.html",                                                              faviconDomain: "gevernova.com",         icon: "📊" },
      { name: "PK8",                  desc: "PK8 system portal",              url: "https://pk8.hhsys.org/index.jsp",                                                                        faviconDomain: null,                    icon: "🔑" },
      { name: "NextPlane SSO",        desc: "Single sign-on portal",          url: "https://sso.nextplanesolutions.com:9443/samlsso?spEntityID=huntsville220831",                            faviconDomain: "nextplanesolutions.com",icon: "🔐" },
      { name: "VPN",                  desc: "Remote access VPN portal",       url: "https://app.mmcenters.com/vpn/index.html",                                                               faviconDomain: "mmcenters.com",         icon: "🌐" },
    ],
  },
];

// Try DuckDuckGo first (better quality), fall back to Google, then emoji
function SiteIcon({ faviconDomain, fallback }) {
  const [stage, setStage] = useState(0); // 0=DDG, 1=Google, 2=emoji

  if (!faviconDomain || stage >= 2) {
    return (
      <div style={iconWrap}>
        <span style={{ fontSize: 20 }}>{fallback}</span>
      </div>
    );
  }

  const src = stage === 0
    ? `https://icons.duckduckgo.com/ip3/${faviconDomain}.ico`
    : `https://www.google.com/s2/favicons?domain=${faviconDomain}&sz=64`;

  return (
    <div style={iconWrap}>
      <img
        src={src}
        alt=""
        width={28}
        height={28}
        style={{ objectFit: "contain" }}
        onError={() => setStage(s => s + 1)}
      />
    </div>
  );
}

const iconWrap = {
  width: 42, height: 42, borderRadius: 10, flexShrink: 0,
  background: "#f9fafb", border: "1px solid #e5e7eb",
  display: "flex", alignItems: "center", justifyContent: "center",
  overflow: "hidden",
};

function AppCard({ name, desc, url, icon, faviconDomain }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      style={{
        display: "flex", alignItems: "center", gap: 14,
        padding: "14px 16px", borderRadius: 10,
        border: "1px solid #e5e7eb", background: "white",
        textDecoration: "none", transition: "border-color 0.15s, box-shadow 0.15s",
      }}
      onMouseOver={e => {
        e.currentTarget.style.borderColor = "var(--brand)";
        e.currentTarget.style.boxShadow = "0 2px 8px rgba(15,81,50,0.12)";
      }}
      onMouseOut={e => {
        e.currentTarget.style.borderColor = "#e5e7eb";
        e.currentTarget.style.boxShadow = "none";
      }}
    >
      <SiteIcon faviconDomain={faviconDomain} fallback={icon} />
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 14, color: "var(--brand-dark, #0f5132)", marginBottom: 2 }}>{name}</div>
        <div style={{ fontSize: 12, color: "#6b7280", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{desc}</div>
      </div>
      <div style={{ marginLeft: "auto", color: "#d1d5db", fontSize: 16, flexShrink: 0 }}>↗</div>
    </a>
  );
}

function WebApps() {
  return (
    <>
      <header className="page-header">
        <h2>Web Applications</h2>
        <p>Quick access to all internal and external systems used at The Heart Center.</p>
      </header>

      {APPS.map(group => (
        <section key={group.category} style={{ marginBottom: 28 }}>
          <h3 style={{ fontSize: 13, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "#6b7280", marginBottom: 12 }}>
            {group.category}
          </h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 10 }}>
            {group.items.map(app => <AppCard key={app.name} {...app} />)}
          </div>
        </section>
      ))}
    </>
  );
}

export default WebApps;
