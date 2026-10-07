// Practice Reports: billing, cases, clients and hearings for a chosen period,
// from /api/reports-center. Charts use recharts, coloured with Red Tape tokens
// so they follow the light and dark themes.
import { useState, useEffect, useCallback } from "react";
import {
  PieChart, Pie, Cell, BarChart, Bar, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import api, { apiUrl, authHeaders } from "../api/client";
import { useLoading } from "../contexts/LoadingContext";
import { usePermission } from "../contexts/PermissionContext";
import { formatCurrency } from "../utils/formatCurrency";
import ReportService from "../services/ReportService";
import { useDownload } from "../hooks/useDownload";
import DownloadLoader from "../components/DownloadLoader";
import { Button, EmptyState, PageHead, Panel, Skel } from "../ui/kit";
import "../ui/pages/finance.css";

const PATH = `/api/reports-center`;

const FILTERS = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "last7", label: "Last 7 days" },
  { value: "last30", label: "Last 30 days" },
  { value: "this-month", label: "This month" },
  { value: "last-month", label: "Last month" },
  { value: "this-year", label: "This year" },
  { value: "custom", label: "Custom range" },
];

// Case status colours: ink for live work, warn for pending, muted for closed, bad for dismissed.
const STATUS_COLORS: Record<string, string> = {
  Active: "var(--ink)", Pending: "var(--warn)", Closed: "var(--ink-3)", Dismissed: "var(--bad)",
};
const axisTick = { fontSize: 11, fill: "var(--ink-3)", fontFamily: "var(--f-sans, inherit)" };
const gridProps = { stroke: "var(--line)", vertical: false } as const;

// Tooltip drawn as a Red Tape popover.
function ChartTip({ active, payload, label, money }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="popover fin-tip">
      {label != null && <div className="fin-tip-h">{label}</div>}
      {payload.map((p: any) => (
        <div key={p.dataKey ?? p.name} className="fin-tip-row">
          <i style={{ background: p.payload?.fill || p.color || p.stroke }} aria-hidden="true" />
          <span className="grow">{p.name}</span>
          <b className="mono">{money ? formatCurrency(p.value) : p.value}</b>
        </div>
      ))}
    </div>
  );
}

function Legend({ items }: { items: { label: string; color: string }[] }) {
  return <div className="legend">{items.map((i) => <span key={i.label}><i style={{ background: i.color }} />{i.label}</span>)}</div>;
}

// Change vs the previous period; "good" direction depends on the measure.
function Delta({ change, goodUp = true }: { change?: number; goodUp?: boolean }) {
  const c = Number(change || 0);
  const good = (c >= 0) === goodUp;
  return <><span className={good ? "up" : "down"}>{c >= 0 ? "+" : "−"}{Math.abs(c)}%</span> vs previous period</>;
}

function Bars({ data, name }: { data: any[]; name: string }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
        <CartesianGrid {...gridProps} />
        <XAxis dataKey="name" tick={axisTick} stroke="var(--line-strong)" tickLine={false} interval={0} />
        <YAxis tick={axisTick} stroke="var(--line-strong)" tickLine={false} axisLine={false} allowDecimals={false} />
        <Tooltip content={<ChartTip />} cursor={{ fill: "var(--surface-2)" }} />
        <Bar dataKey="count" fill="var(--ink)" radius={[4, 4, 0, 0]} maxBarSize={36} name={name} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export default function ReportsCenter() {
  const { hasPermission } = usePermission() as any;
  const { withLoading } = useLoading() as any;
  const { isDownloading, withDownload } = useDownload() as any;
  const [filter, setFilter] = useState("this-month");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const canExport = hasPermission("REPORT_EXPORT");

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      let url = `${PATH}?filter=${filter}`;
      if (filter === "custom" && customStart && customEnd) {
        url += `&startDate=${customStart}&endDate=${customEnd}`;
      }
      const res = await withLoading(api.get(url), "Loading reports...");
      setData(res.data);
    } catch (err) {
      console.error("[ReportsCenter] Error:", err);
    } finally {
      setLoading(false);
    }
  }, [filter, customStart, customEnd, withLoading]);

  useEffect(() => {
    if (filter !== "custom") fetchData();
  }, [filter, fetchData]);

  useEffect(() => {
    if (filter === "custom" && customStart && customEnd) fetchData();
  }, [customStart, customEnd, filter, fetchData]);

  const handleExportCsv = async (section: string) => {
    await withDownload(async () => {
      let url = apiUrl(`${PATH}/export/csv?section=${section}&filter=${filter}`);
      if (filter === "custom" && customStart && customEnd) {
        url += `&startDate=${customStart}&endDate=${customEnd}`;
      }
      const res = await fetch(url, { headers: authHeaders() });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = `report-${section}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(objectUrl);
    }, "Exporting CSV...");
  };

  const handleExportPdf = async () => {
    await withDownload((ReportService as any).downloadDashboard(), "Exporting PDF...");
  };

  const fin = data?.financial;
  const cases = data?.cases;
  const clients = data?.clients;
  const hearings = data?.hearings;

  const casePieData = cases ? [
    { name: "Active", value: cases.active },
    { name: "Pending", value: cases.pending },
    { name: "Closed", value: cases.closed },
    { name: "Dismissed", value: cases.dismissed },
  ].filter((d) => d.value > 0) : [];
  const caseTotal = casePieData.reduce((s, d) => s + d.value, 0);

  const sectionHead = (title: string, section: string) => (
    <div className="section-title">
      <h2>{title}</h2>
      {canExport && <Button size="sm" variant="ghost" icon="download" onClick={() => handleExportCsv(section)}>Download CSV</Button>}
    </div>
  );

  return (
    <div className="fin-page fin-reports">
      {isDownloading && <DownloadLoader />}
      <PageHead title="Practice Reports" sub="Practice performance across billing, cases, clients and hearings."
        actions={canExport && <Button variant="primary" icon="download" onClick={handleExportPdf}>Export PDF</Button>} />

      <div className="toolbar">
        <label className="sr-only" htmlFor="rc-range">Date range</label>
        <select id="rc-range" className="input" value={filter} onChange={(e) => setFilter(e.target.value)}>
          {FILTERS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
        </select>
        {filter === "custom" && (
          <div className="row wrap">
            <label className="sr-only" htmlFor="rc-from">From</label>
            <input id="rc-from" type="date" className="input fin-date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} />
            <span className="faint">to</span>
            <label className="sr-only" htmlFor="rc-to">To</label>
            <input id="rc-to" type="date" className="input fin-date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} />
          </div>
        )}
      </div>

      {loading && (
        <div className="stack" aria-busy="true">
          <Skel h={110} />
          <Skel h={300} />
          <div className="cols g-3 fin-cols"><Skel h={240} /><Skel h={240} /><Skel h={240} /></div>
        </div>
      )}

      {!loading && !data && (
        <EmptyState icon="chart" title="No data available" text="Try a different date range." />
      )}

      {!loading && data && (
        <>
          {sectionHead("Financial", "financial")}
          {fin ? (
            <div className="stack">
              <div className="figures">
                <div className="figure"><div className="lbl">Revenue</div><div className="val">{formatCurrency(fin.revenue?.current || 0)}</div>
                  <div className="meta"><Delta change={fin.revenue?.change} /></div></div>
                <div className="figure"><div className="lbl">Expenses</div><div className="val">{formatCurrency(fin.expenses?.current || 0)}</div>
                  <div className="meta"><Delta change={fin.expenses?.change} goodUp={false} /></div></div>
                <div className="figure"><div className="lbl">Net income</div><div className="val">{formatCurrency(fin.netIncome?.current || 0)}</div>
                  <div className="meta"><Delta change={fin.netIncome?.change} /></div></div>
                <div className="figure"><div className="lbl">Outstanding</div><div className="val">{formatCurrency(fin.outstandingPayments?.total || 0)}</div>
                  <div className="meta">Unpaid invoices</div></div>
              </div>
              {fin.cashFlow && fin.cashFlow.length > 0 && (
                <Panel title="Cash flow" actions={<Legend items={[{ label: "Income", color: "var(--ink)" }, { label: "Expenses", color: "var(--tape)" }]} />}>
                  <ResponsiveContainer width="100%" height={280}>
                    <AreaChart data={fin.cashFlow} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                      <CartesianGrid {...gridProps} />
                      <XAxis dataKey="month" tick={axisTick} stroke="var(--line-strong)" tickLine={false} />
                      <YAxis tick={axisTick} stroke="var(--line-strong)" tickLine={false} axisLine={false} width={64}
                        tickFormatter={(n) => formatCurrency(n)} />
                      <Tooltip content={<ChartTip money />} cursor={{ stroke: "var(--line-strong)" }} />
                      <Area type="monotone" dataKey="income" stroke="var(--ink)" fill="var(--ink)" fillOpacity={0.06} strokeWidth={2} name="Income"
                        activeDot={{ r: 4, stroke: "var(--surface)", strokeWidth: 2 }} />
                      <Area type="monotone" dataKey="expense" stroke="var(--tape)" fill="var(--tape)" fillOpacity={0.06} strokeWidth={2} strokeDasharray="5 4" name="Expenses"
                        activeDot={{ r: 4, stroke: "var(--surface)", strokeWidth: 2 }} />
                    </AreaChart>
                  </ResponsiveContainer>
                </Panel>
              )}
            </div>
          ) : <p className="faint small">Financial data unavailable for this period.</p>}

          {sectionHead("Cases", "cases")}
          {cases ? (
            <div className="stack">
              <div className="figures">
                <div className="figure"><div className="lbl">Active</div><div className="val">{cases.active ?? 0}</div></div>
                <div className="figure"><div className="lbl">Pending</div><div className="val">{cases.pending ?? 0}</div></div>
                <div className="figure"><div className="lbl">Closed</div><div className="val">{cases.closed ?? 0}</div></div>
                <div className="figure"><div className="lbl">Dismissed</div><div className="val">{cases.dismissed ?? 0}</div></div>
              </div>
              <div className="cols g-3 fin-cols">
                {casePieData.length > 0 && (
                  <Panel title="By status">
                    <div className="fin-donut">
                      <ResponsiveContainer width="100%" height={200}>
                        <PieChart>
                          <Pie data={casePieData} cx="50%" cy="50%" innerRadius={62} outerRadius={84} paddingAngle={2} dataKey="value"
                            stroke="var(--surface)" strokeWidth={2} isAnimationActive={false}>
                            {casePieData.map((d) => <Cell key={d.name} fill={STATUS_COLORS[d.name]} />)}
                          </Pie>
                          <Tooltip content={<ChartTip />} />
                        </PieChart>
                      </ResponsiveContainer>
                      <div className="fin-donut-c" aria-hidden="true"><b>{caseTotal}</b><span>cases</span></div>
                    </div>
                    <Legend items={casePieData.map((d) => ({ label: `${d.name} ${d.value}`, color: STATUS_COLORS[d.name] }))} />
                  </Panel>
                )}
                {cases.courtDistribution && cases.courtDistribution.length > 0 && (
                  <Panel title="By court"><Bars data={cases.courtDistribution} name="Cases" /></Panel>
                )}
                {cases.typeDistribution && cases.typeDistribution.length > 0 && (
                  <Panel title="By case type"><Bars data={cases.typeDistribution} name="Cases" /></Panel>
                )}
              </div>
            </div>
          ) : <p className="faint small">Case data unavailable for this period.</p>}

          {sectionHead("Clients", "clients")}
          {clients ? (
            <div className="stack">
              <div className="figures">
                <div className="figure"><div className="lbl">New clients</div><div className="val">{clients.newClients?.current || 0}</div>
                  <div className="meta"><Delta change={clients.newClients?.change} /></div></div>
                <div className="figure"><div className="lbl">Pending payments</div><div className="val">{formatCurrency(clients.pendingPayments?.total || 0)}</div>
                  <div className="meta">{clients.pendingPayments?.count || 0} invoices outstanding</div></div>
              </div>
              {clients.growth && clients.growth.length > 0 && (
                <Panel title="New clients per month">
                  <ResponsiveContainer width="100%" height={240}>
                    <BarChart data={clients.growth} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                      <CartesianGrid {...gridProps} />
                      <XAxis dataKey="month" tick={axisTick} stroke="var(--line-strong)" tickLine={false} />
                      <YAxis tick={axisTick} stroke="var(--line-strong)" tickLine={false} axisLine={false} allowDecimals={false} />
                      <Tooltip content={<ChartTip />} cursor={{ fill: "var(--surface-2)" }} />
                      <Bar dataKey="count" fill="var(--ink)" radius={[4, 4, 0, 0]} maxBarSize={36} name="New clients" />
                    </BarChart>
                  </ResponsiveContainer>
                </Panel>
              )}
            </div>
          ) : <p className="faint small">Client data unavailable for this period.</p>}

          {hasPermission("EVENT_VIEW") && (
            <>
              {sectionHead("Hearings", "hearings")}
              {hearings ? (
                <div className="stack">
                  <div className="figures">
                    <div className="figure"><div className="lbl">Today</div><div className="val">{hearings.today ?? 0}</div><div className="meta">Listed across all courts</div></div>
                    <div className="figure"><div className="lbl">Upcoming</div><div className="val">{hearings.upcoming ?? 0}</div><div className="meta">Scheduled hearings</div></div>
                    <div className="figure"><div className="lbl">Missed</div><div className={`val${hearings.missed > 0 ? " fin-bad" : ""}`}>{hearings.missed ?? 0}</div><div className="meta">Missed hearings</div></div>
                  </div>
                  {hearings.courtWise && hearings.courtWise.length > 0 && (
                    <Panel title="Hearings by court"><Bars data={hearings.courtWise} name="Hearings" /></Panel>
                  )}
                </div>
              ) : <p className="faint small">Hearing data unavailable.</p>}
            </>
          )}
        </>
      )}
    </div>
  );
}
