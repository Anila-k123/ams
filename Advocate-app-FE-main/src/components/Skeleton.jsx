import React from "react";

export function Skeleton({ width, height, borderRadius = 8, className, style }) {
  return (
    <div
      className={`skeleton ${className || ""}`}
      style={{ width, height, borderRadius, ...style }}
    />
  );
}

export function SkeletonText({ lines = 3, width = "100%" }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton
          key={i}
          width={i === lines - 1 ? "60%" : width}
          height={12}
          borderRadius={4}
        />
      ))}
    </div>
  );
}

export function SkeletonCard({ height = 100 }) {
  return (
    <div className="skeleton-card" style={{ pointerEvents: "none", height }}>
      <div className="skeleton-card-left">
        <Skeleton width={80} height={12} borderRadius={4} />
        <Skeleton width={60} height={28} borderRadius={4} style={{ margin: "8px 0" }} />
        <Skeleton width={70} height={10} borderRadius={4} />
      </div>
      <Skeleton width={40} height={40} borderRadius={8} />
    </div>
  );
}

export function SkeletonChart({ height = 200, bars = 8 }) {
  const barHeights = Array.from({ length: bars }, () => Math.floor(Math.random() * 40 + 20));
  return (
    <div
      className="skeleton-chart"
      style={{ display: "flex", alignItems: "flex-end", gap: 8, height, padding: "0 8px" }}
    >
      {barHeights.map((h, i) => (
        <Skeleton key={i} width="100%" height={`${h}%`} borderRadius={4} />
      ))}
    </div>
  );
}

export function SkeletonTable({ rows = 5, columns = 4 }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* header */}
      <div style={{ display: "flex", gap: 16, padding: "0 12px" }}>
        {Array.from({ length: columns }, (_, i) => (
          <Skeleton key={i} flex={1} height={16} borderRadius={4} />
        ))}
      </div>
      {/* rows */}
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} style={{ display: "flex", gap: 16, padding: "0 12px" }}>
          {Array.from({ length: columns }, (_, c) => (
            <Skeleton key={c} flex={1} height={14} borderRadius={4} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function SkeletonAvatar({ size = 36 }) {
  return <Skeleton width={size} height={size} borderRadius="50%" />;
}

export function SkeletonList({ items = 4, avatar = true }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {Array.from({ length: items }, (_, i) => (
        <div key={i} style={{ display: "flex", gap: 10, alignItems: "center" }}>
          {avatar && <SkeletonAvatar size={32} />}
          <div style={{ flex: 1 }}>
            <Skeleton width="60%" height={12} borderRadius={4} />
            <Skeleton width="40%" height={10} borderRadius={4} style={{ marginTop: 4 }} />
          </div>
          <Skeleton width={50} height={16} borderRadius={4} />
        </div>
      ))}
    </div>
  );
}

export function SkeletonPage({ lines = 6 }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, padding: 24 }}>
      <Skeleton width={200} height={24} borderRadius={4} />
      <Skeleton width="100%" height={40} borderRadius={8} />
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} width={i % 3 === 0 ? "80%" : "100%"} height={14} borderRadius={4} />
      ))}
    </div>
  );
}

export function SkeletonHearingItem() {
  return (
    <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
      <Skeleton width={44} height={44} borderRadius={8} />
      <div style={{ flex: 1 }}>
        <Skeleton width="70%" height={12} borderRadius={4} />
        <Skeleton width="50%" height={10} borderRadius={4} style={{ marginTop: 4 }} />
      </div>
      <Skeleton width={40} height={10} borderRadius={4} />
    </div>
  );
}

export function SkeletonDocCard() {
  return (
    <div className="skeleton" style={{ height: 200, borderRadius: 12 }} />
  );
}

export function SkeletonInvoiceRow() {
  return (
    <div style={{ display: "flex", gap: 12, alignItems: "center", padding: "8px 0" }}>
      <Skeleton width={100} height={14} borderRadius={4} />
      <Skeleton width={120} height={14} borderRadius={4} />
      <Skeleton width={80} height={14} borderRadius={4} />
      <Skeleton width={60} height={20} borderRadius={4} style={{ marginLeft: "auto" }} />
    </div>
  );
}

export function SkeletonTaskItem() {
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
      <Skeleton width={18} height={18} borderRadius={4} />
      <Skeleton width="50%" height={12} borderRadius={4} />
      <Skeleton width={40} height={16} borderRadius={4} style={{ marginLeft: "auto" }} />
    </div>
  );
}

export default Skeleton;
