import { getEmbedUrl } from "../utils/embedUrl";

function fmtDate(str) {
  if (!str) return "";
  const s = str.endsWith("Z") ? str : str + "Z";
  return new Date(s).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric", timeZone: "America/Chicago",
  });
}

function AnnouncementCard({ post }) {
  const embedUrl = getEmbedUrl(post.video_url);

  return (
    <article className="announcement-card">
      {post.photo_url && (
        <img src={post.photo_url} alt="" className="announcement-photo" />
      )}

      {embedUrl && (
        <div style={{ position: "relative", paddingBottom: "56.25%", height: 0, margin: "0 0 16px", borderRadius: 10, overflow: "hidden", background: "#000" }}>
          <iframe
            src={embedUrl}
            title={post.title}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", border: "none" }}
          />
        </div>
      )}

      <div className="announcement-header">
        <div>
          <h4>{post.title}</h4>
          <div className="announcement-meta">
            {post.author || "Administration"} • {fmtDate(post.created_at)}
          </div>
        </div>
        <span className="announcement-tag">Internal</span>
      </div>

      <p>{post.content}</p>
    </article>
  );
}

export default AnnouncementCard;
