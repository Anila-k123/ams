import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import { useToast } from "../contexts/ToastContext";
import api from "../api/client";
import { Icon, Chip, PageHead, EmptyState, Skel } from "../ui/kit";
import "../ui/pages/court.css";

const p2 = (n: number) => String(n).padStart(2, "0");
const toISO = (d: Date) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
// Kept as the original (UTC-based) "today" so the default date/max are unchanged.
const todayISO = () => new Date().toISOString().slice(0, 10);
const parse = (s: string) => new Date(`${s}T00:00:00`);
const longDate = (s: string) => parse(s).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
const shortDate = (s: string) => parse(s).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
const shift = (s: string, n: number) => { const d = parse(s); d.setDate(d.getDate() + n); return toISO(d); };

// This practice's matters that sit in a court's cause list for a given day —
// the item number each is listed at. A dedicated page (separate from the Court
// Display Board, which is for browsing any court's live board).
export default function DailyCauselist() {
  const { success, error } = useToast();
  const [date, setDate] = useState(todayISO());
  const [listings, setListings] = useState<any[]>([]);
  const [covered, setCovered] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  // Set when the cause list could not be read (503 = the court data service is down).
  const [loadError, setLoadError] = useState<"down" | "failed" | null>(null);
  const [alertBusy, setAlertBusy] = useState<string | null>(null);

  // Manually forward one listing to the client. Reuses the case hearing-alert
  // email endpoint (which pulls the client's address from the case).
  const alertClient = useCallback(async (l: any) => {
    const key = `${l.caseId}-${l.courtNumber}-${l.itemNumber}`;
    setAlertBusy(key);
    try {
      const res = await api.post(`/api/cases/${l.caseId}/hearing-alert`, {
        date: l.listDate || date,
        purpose: "Listed in cause list",
        bench: l.courtNumber ? `Court ${l.courtNumber}, item ${l.itemNumber}` : "",
        note: `Listed as: ${l.caseString || l.caseNumber}`,
      });
      if (res.data?.success) success(`Alert sent to client (${res.data.recipient}).`);
      else error(res.data?.errorMessage || "Alert could not be sent.");
    } catch (err: any) {
      error(err.response?.data?.errorMessage || err.response?.data?.error || "Failed to send alert.");
    } finally {
      setAlertBusy(null);
    }
  }, [date, success, error]);

  const fetchListings = useCallback(async (on: string) => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await api.get("/api/causelist/my-listings", { params: { date: on } });
      setListings(res.data?.listings || []);
      setCovered(res.data?.coveredCourts || []);
    } catch (err: any) {
      setListings([]);
      setCovered([]);
      setLoadError(err?.response?.status === 503 ? "down" : "failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchListings(date); }, [date, fetchListings]);

  // Group by court so a day's listings read as "under this court, these items".
  const byCourt: Record<string, any[]> = listings.reduce((acc: Record<string, any[]>, l) => {
    const key = l.courtLabel || l.court;
    (acc[key] = acc[key] || []).push(l);
    return acc;
  }, {});
  const isToday = date === todayISO();

  return (
    <div className="court">
      <PageHead title="Daily Cause List" sub={`Your matters in the cause lists for ${longDate(date)}.`} />

      <div className="toolbar">
        <button type="button" className="btn icon" aria-label="Previous day" onClick={() => setDate(shift(date, -1))}><Icon name="chevronLeft" size="sm" /></button>
        <label className="sr-only" htmlFor="cl-date">Cause list date</label>
        <input id="cl-date" type="date" className="input court-date" value={date} max={todayISO()}
          onChange={(e) => setDate(e.target.value || todayISO())} />
        <button type="button" className="btn icon" aria-label="Next day" disabled={date >= todayISO()} onClick={() => setDate(shift(date, 1))}><Icon name="chevron" size="sm" /></button>
        {!isToday && <button type="button" className="btn ghost" onClick={() => setDate(todayISO())}>Today</button>}
        <span className="grow" />
        {!loading && !loadError && <span className="faint small">{listings.length} matter{listings.length === 1 ? "" : "s"}</span>}
      </div>

      {loading ? (
        <div className="panel"><div className="panel-body stack"><Skel h={18} w="40%" /><Skel h={44} /><Skel h={44} /><Skel h={44} /></div></div>
      ) : loadError ? (
        <div className={`callout ${loadError === "down" ? "warn" : "bad"}`} role="alert">
          <Icon name="warn" size="sm" />
          <div className="grow">
            {loadError === "down"
              ? <><b>The court data service is not reachable.</b><div className="small">Cause lists can't be read right now. Your cases and calendar are unaffected; try again in a few minutes.</div></>
              : <b>Couldn't load the cause list for this date.</b>}
          </div>
          <button type="button" className="btn sm" onClick={() => fetchListings(date)}><Icon name="refresh" size="sm" />Retry</button>
        </div>
      ) : !listings.length ? (
        <div className="panel">
          <EmptyState icon="list" title={`Nothing of yours is listed on ${shortDate(date)}`}
            text={covered.length
              ? `Checked ${covered.length === 1 ? "the court" : `the ${covered.length} courts`} we hold a cause list for. Try another date, or check the display board for live court status.`
              : "No cause list has been collected for this date yet."} />
        </div>
      ) : (
        Object.entries(byCourt).map(([courtLabel, rows]) => (
          <section className="panel court-gap-b" key={courtLabel}>
            <div className="panel-head"><h3 className="serif court-court-h">{courtLabel} <span className="faint">({rows.length})</span></h3></div>
            <div className="table-wrap court-flush">
              <table className="t">
                <thead><tr><th scope="col">Item</th><th scope="col">Case</th><th scope="col" className="hide-sm">Court hall</th><th scope="col" className="actions"><span className="sr-only">Actions</span></th></tr></thead>
                <tbody>
                  {rows.map((l: any) => {
                    const key = `${l.caseId}-${l.courtNumber}-${l.itemNumber}`;
                    return (
                      <tr key={`${l.caseId}-${l.court}-${l.courtNumber}-${l.itemNumber}`}>
                        <td><div className="pp-cl-item">{l.itemNumber}</div></td>
                        <td>
                          <Link className="mono link" to={`/dashboard/cases/${l.caseId}`} title="Open this case">{l.caseString || l.caseNumber}</Link>
                          {l.caseString && l.caseNumber && l.caseString !== l.caseNumber && <div className="cell-sub mono">{l.caseNumber}</div>}
                        </td>
                        <td className="hide-sm"><Chip plain>Court {l.courtNumber || "—"}</Chip></td>
                        <td className="actions">
                          <button type="button" className={`btn sm${alertBusy === key ? " loading" : ""}`}
                            disabled={!l.clientId || alertBusy === key}
                            title={l.clientId ? "Email this listing to the client" : "No client linked to this case"}
                            onClick={() => alertClient(l)}>
                            <Icon name="send" size="sm" />{alertBusy === key ? "Sending…" : "Send alert to client"}
                          </button>
                          {!l.clientId && <span className="sr-only">No client is linked to this case</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        ))
      )}
    </div>
  );
}
