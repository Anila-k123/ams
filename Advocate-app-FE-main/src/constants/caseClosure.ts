// Why a case is closed (backend cases/closure.py, docs/CASE_CLOSURE.md). "Decided by the court" keeps the court
// watch going for final orders and appeals; the others stop everything that reaches the court or the client.
export const CLOSE_REASONS = [
  { value: "court_decided", label: "Decided by the court",
    hint: "Judgment or disposal. New orders are still checked weekly and Appeal Alerts apply." },
  { value: "no_longer_acting", label: "We no longer act for the client",
    hint: "Client moved to another advocate, NOC given, vakalat withdrawn. Court monitoring, alerts and client emails stop." },
  { value: "settled", label: "Settled / withdrawn by the client",
    hint: "The matter ended out of court. Monitoring and alerts stop." },
  { value: "other", label: "Other",
    hint: "Monitoring and alerts stop. Add a note." },
] as const;

export const closeReasonLabel = (value?: string) =>
  CLOSE_REASONS.find((r) => r.value === value)?.label || "";

export const isClosedStatus = (status?: string) => /^(closed|disposed|decided)$/i.test((status || "").trim());
