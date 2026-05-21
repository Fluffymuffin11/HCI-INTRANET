import { useEffect, useState } from "react";
import { getPosts } from "../services/api";
import AnnouncementCard from "../components/AnnouncementCard";

function Announcements() {
  const [posts, setPosts] = useState([]);

  useEffect(() => {
    async function loadPosts() {
      try {
        const data = await getPosts();
        setPosts(data);
      } catch (err) {
        console.error(err);
      }
    }

    loadPosts();
  }, []);

  return (
    <>
      <header className="page-header">
        <h2>Announcements</h2>
        <p>Company updates, leadership communications, and internal notices.</p>
      </header>

      <section className="page-grid-single">
        {posts.length === 0 ? (
          <div className="card">No announcements available.</div>
        ) : (
          posts.map((post) => (
            <AnnouncementCard key={post.id} post={post} />
          ))
        )}
      </section>
    </>
  );
}

export default Announcements;
