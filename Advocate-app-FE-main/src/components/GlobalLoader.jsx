import { useLoading } from "../contexts/LoadingContext";

export default function GlobalLoader() {
  const { visible, message } = useLoading();

  return (
    <div className={`global-loader-overlay ${visible ? "visible" : ""}`}>
      <div className="global-loader-inner">
        <svg className="global-loader-svg" viewBox="0 0 50 50">
          <circle className="global-loader-track" cx="25" cy="25" r="20" />
          <circle className="global-loader-stroke" cx="25" cy="25" r="20" />
        </svg>
        <p className="global-loader-message">{message}</p>
      </div>
    </div>
  );
}
