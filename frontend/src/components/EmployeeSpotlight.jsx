import { useEffect, useState } from "react";
import { getSpotlight } from "../services/api";

function EmployeeSpotlight() {
  const [spotlight, setSpotlight] = useState(null);

  useEffect(() => {
    async function loadSpotlight() {
      try {
        const data = await getSpotlight();
        setSpotlight(data);
      } catch (err) {
        console.error(err);
      }
    }

    loadSpotlight();
  }, []);

  if (!spotlight) {
    return (
      <div className="card">
        <h3>Employee Spotlight</h3>
        <p>Loading spotlight...</p>
      </div>
    );
  }

  return (
    <div className="card spotlight-card">
      <h3>Employee Spotlight</h3>

      <div className="spotlight">
        {spotlight.photo_url ? (
          <img
            src={spotlight.photo_url}
            alt={spotlight.name}
            className="spotlight-photo"
          />
        ) : (
          <div className="spotlight-avatar">
            {spotlight.name
              ?.split(" ")
              .map((part) => part[0])
              .join("")
              .slice(0, 2)
              .toUpperCase()}
          </div>
        )}

        <div>
          <h4>{spotlight.name}</h4>
          <p>{spotlight.title}</p>
        </div>
      </div>

      <div className="spotlight-text">
        {spotlight.message}
      </div>
    </div>
  );
}

export default EmployeeSpotlight;
