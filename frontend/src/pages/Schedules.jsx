import { useEffect, useState } from "react";
import { getSchedules } from "../services/api";

function Schedules() {
  const [schedules, setSchedules] = useState([]);

  useEffect(() => {
    async function loadSchedules() {
      try {
        const data = await getSchedules();
        setSchedules(data);
      } catch (err) {
        console.error(err);
      }
    }

    loadSchedules();
  }, []);

  return (
    <>
      <header className="page-header">
        <h2>Department Schedules</h2>
        <p>View weekly schedules and department staffing documents.</p>
      </header>

      <section className="card">
        {schedules.length === 0 ? (
          <p>No schedules have been uploaded yet.</p>
        ) : (
          <div className="resource-list">
            {schedules.map((schedule) => (
              <div className="resource-row" key={schedule.id}>
                <div>
                  <h4>{schedule.title}</h4>
                  <p>
                    {schedule.department} • Week of {schedule.week_of || "N/A"}
                  </p>
                </div>

                <a
                  href={`/api/files/schedules/${schedule.filename}`}
                  download={schedule.original_name}
                  className="green-btn"
                  style={{ marginTop: 0 }}
                >
                  Download
                </a>
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  );
}

export default Schedules;
