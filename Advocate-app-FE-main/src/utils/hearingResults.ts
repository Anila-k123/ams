// What happened at a hearing (events/scheduling.py on the server decides from it
// whether the next date becomes a new hearing; "Disposed" never schedules one).
export const HEARING_RESULTS = [
  { value: "ADJOURNED", label: "Adjourned" },
  { value: "PART_HEARD", label: "Part-heard" },
  { value: "RESERVED", label: "Orders / judgment reserved" },
  { value: "DISPOSED", label: "Disposed" },
  { value: "NOT_REACHED", label: "Not reached" },
  { value: "OTHER", label: "Other" },
];

export const resultLabel = (code?: string | null) => HEARING_RESULTS.find((r) => r.value === code)?.label || "";

/** The toast for a saved hearing, saying when its next date became (or moved) a hearing. */
export function savedHearingMessage(base: string, data: any): string {
  const next = data?.nextHearing;
  if (!next?.date) return base;
  const when = new Date(`${next.date}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  return `${base} Next hearing ${next.created ? "scheduled" : "set"} for ${when}.`;
}
