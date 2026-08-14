import { Skeleton, SkeletonTable, SkeletonCard, SkeletonPage } from "./Skeleton";
import "../assets/styles/Loader.css";

export function Spinner({ message, size = 40 }) {
  return (
    <div className="loader-spinner-wrap">
      <svg className="loader-spinner" viewBox="0 0 50 50" style={{ width: size, height: size }}>
        <circle className="loader-spinner-track" cx="25" cy="25" r="20" />
        <circle className="loader-spinner-stroke" cx="25" cy="25" r="20" />
      </svg>
      {message && <p className="loader-spinner-message">{message}</p>}
    </div>
  );
}

export function ButtonSpinner({ size = 16 }) {
  return (
    <svg className="loader-button-spinner" viewBox="0 0 50 50" style={{ width: size, height: size }}>
      <circle className="loader-spinner-stroke" cx="25" cy="25" r="20" />
    </svg>
  );
}

export function PageLoader({ message }) {
  return (
    <div className="loader-page">
      <Spinner message={message} />
    </div>
  );
}

export function InlineLoader({ type = "spinner", rows, columns, count, message }) {
  switch (type) {
    case "table":
      return (
        <div className="loader-inline">
          <SkeletonTable rows={rows || 6} columns={columns || 4} />
        </div>
      );
    case "card":
      return (
        <div className="loader-card-grid">
          {Array.from({ length: count || 4 }, (_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      );
    case "page":
      return (
        <div className="loader-inline">
          <SkeletonPage lines={8} />
        </div>
      );
    case "spinner":
    default:
      return <Spinner message={message} />;
  }
}

export default InlineLoader;
