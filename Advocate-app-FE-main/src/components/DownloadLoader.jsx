import { useState, useEffect } from "react";
import DownloadManager from "../utils/DownloadManager";
import "../assets/styles/DownloadLoader.css";

export function DownloadLoader() {
  const [active, setActive] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const unsub = DownloadManager.subscribe((s) => {
      setActive(s.active);
      setMessage(s.message);
    });
    return unsub;
  }, []);

  if (!active) return null;

  return (
    <div className="dl-overlay">
      <div className="dl-container">
        <div className="dl-loader" />
        {message && <p className="dl-message">{message}</p>}
      </div>
    </div>
  );
}

export default DownloadLoader;
