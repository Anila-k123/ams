import { useState, useEffect, useCallback } from "react";
import {
  PieChart, Pie, Cell, BarChart, Bar, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { Dropdown } from "primereact/dropdown";
import { Calendar } from "primereact/calendar";
import { Button } from "primereact/button";
import { Card } from "primereact/card";
import { ProgressSpinner } from "primereact/progressspinner";
import api, { apiUrl, authHeaders } from "../api/client";
import { useLoading } from "../contexts/LoadingContext";
import { formatCurrency } from "../utils/formatCurrency";
import ReportService from "../services/ReportService";
import { useDownload } from "../hooks/useDownload";
import DownloadLoader from "../components/DownloadLoader";
import "../assets/styles/ReportsCenter.css";

const PATH = `/api/reports-center`;

const FILTERS = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "last7", label: "Last 7 Days" },
  { value: "last30", label: "Last 30 Days" },
  { value: "this-month", label: "This Month" },
  { value: "last-month", label: "Last Month" },
  { value: "this-year", label: "This Year" },
  { value: "custom", label: "Custom Range" },
];

const PIE_COLORS = ["#3B82F6", "#F59E0B", "#10B981", "#EF4444"];
const TOOLTIP_STYLE = { background: "var(--card-bg)", border: "1px solid var(--border-color)", borderRadius: 8, color: "var(--text-primary)" };

// Calendar gives a Date; the API wants the YYYY-MM-DD the old <input type="date"> produced.
const toYmd = (d: any) => {
  if (!d) return "";
  const dt = d as Date;
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
};
const fromYmd = (s: string) => (s ? new Date(`${s}T00:00:00`) : null);

function MetricCard({ title, value, change, icon, format }: any) {
  const isPositive = change >= 0;
  const displayValue = format === "currency" ? formatCurrency(value) : value;
  return (
    <div className="rc-metric-card">
      <div className="rc-metric-header">
        <span className="rc-metric-icon"><i className={`pi ${icon}`} /></span>
        <span className="rc-metric-title">{title}</span>
      </div>
      <div className="rc-metric-value">{displayValue}</div>
      <div className={`rc-metric-change ${isPositive ? "positive" : "negative"}`}>
        <i className={`pi ${isPositive ? "pi-arrow-up-right" : "pi-arrow-down-right"}`} />
        <span>{Math.abs(change)}% vs previous period</span>
      </div>
    </div>
  );
}

function StatCard({ label, value, color, icon }: any) {
  return (
    <div className="rc-stat-card">
      {icon && <i className={`pi ${icon} rc-stat-icon`} style={{ color }} />}
      <span className="rc-stat-label">{label}</span>
      <span className="rc-stat-value" style={{ color }}>{value}</span>
    </div>
  );
}

function Section({ title, onCsv, children }: any) {
  return (
    <Card className="mb-4">
      <div className="flex justify-content-between align-items-center mb-3 gap-2 flex-wrap">
        <h3 className="rc-section-title">{title}</h3>
        <Button size="small" outlined icon="pi pi-download" label="CSV" onClick={onCsv} />
      </div>
      {children}
    </Card>
  );
}

function ChartBox({ title, children, half }: any) {
  return (
    <div className={half ? "col-12 lg:col-4" : "col-12"}>
      <div className="rc-chart-container">
        <h4 className="rc-chart-title">{title}</h4>
        {children}
      </div>
    </div>
  );
}

export default function ReportsCenter() {
  const { withLoading } = useLoading() as any;
  const { isDownloading, withDownload } = useDownload() as any;
  const [filter, setFilter] = useState("this-month");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

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

  const axisTick = { fontSize: 12, fill: "var(--text-muted)" };

  return (
    <div className="reports-center">
      {isDownloading && <DownloadLoader />}
      <div className="flex justify-content-between align-items-center flex-wrap gap-3 mb-4">
        <p className="rc-page-subtitle">Comprehensive insights into your practice</p>
        <div className="flex align-items-center gap-2 flex-wrap">
          <Dropdown value={filter} options={FILTERS} onChange={(e) => setFilter(e.value)} />
          {filter === "custom" && (
            <div className="flex align-items-center gap-2">
              <Calendar value={fromYmd(customStart)} onChange={(e) => setCustomStart(toYmd(e.value))} dateFormat="dd/mm/yy" showIcon placeholder="Start" />
              <span className="rc-muted">to</span>
              <Calendar value={fromYmd(customEnd)} onChange={(e) => setCustomEnd(toYmd(e.value))} dateFormat="dd/mm/yy" showIcon placeholder="End" />
            </div>
          )}
          <Button icon="pi pi-file-pdf" label="Export PDF" onClick={handleExportPdf} />
        </div>
      </div>

      {loading && (
        <div className="flex flex-column align-items-center gap-2 p-6 rc-muted">
          <ProgressSpinner style={{ width: 40, height: 40 }} strokeWidth="5" />
          <span>Loading reports...</span>
        </div>
      )}

      {!loading && !data && (
        <div className="rc-empty">
          <i className="pi pi-exclamation-circle" style={{ fontSize: 40 }} />
          <h3>No data available</h3>
          <p>Try adjusting the date filter.</p>
        </div>
      )}

      {!loading && data && (
        <>
          <Section title="Financial Overview" onCsv={() => handleExportCsv("financial")}>
            {fin ? (
              <>
                <div className="rc-metrics-grid">
                  <MetricCard title="Revenue" value={fin.revenue?.current || 0} change={fin.revenue?.change || 0} icon="pi-indian-rupee" format="currency" />
                  <MetricCard title="Expenses" value={fin.expenses?.current || 0} change={fin.expenses?.change || 0} icon="pi-arrow-down-right" format="currency" />
                  <MetricCard title="Net Income" value={fin.netIncome?.current || 0} change={fin.netIncome?.change || 0} icon="pi-arrow-up-right" format="currency" />
                  <MetricCard title="Outstanding" value={fin.outstandingPayments?.total || 0} change={0} icon="pi-exclamation-circle" format="currency" />
                </div>
                {fin.cashFlow && fin.cashFlow.length > 0 && (
                  <div className="grid mt-2">
                    <ChartBox title="Cash Flow">
                      <ResponsiveContainer width="100%" height={280}>
                        <AreaChart data={fin.cashFlow}>
                          <defs>
                            <linearGradient id="incomeGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#10B981" stopOpacity={0.3} /><stop offset="95%" stopColor="#10B981" stopOpacity={0} /></linearGradient>
                            <linearGradient id="expenseGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#EF4444" stopOpacity={0.3} /><stop offset="95%" stopColor="#EF4444" stopOpacity={0} /></linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                          <XAxis dataKey="month" tick={axisTick} stroke="var(--text-muted)" />
                          <YAxis tick={axisTick} stroke="var(--text-muted)" />
                          <Tooltip contentStyle={TOOLTIP_STYLE} />
                          <Legend />
                          <Area type="monotone" dataKey="income" stroke="#10B981" fill="url(#incomeGrad)" strokeWidth={2} name="Income" />
                          <Area type="monotone" dataKey="expense" stroke="#EF4444" fill="url(#expenseGrad)" strokeWidth={2} name="Expenses" />
                        </AreaChart>
                      </ResponsiveContainer>
                    </ChartBox>
                  </div>
                )}
              </>
            ) : (
              <div className="rc-section-empty">Financial data unavailable for this period.</div>
            )}
          </Section>

          <Section title="Case Overview" onCsv={() => handleExportCsv("cases")}>
            {cases ? (
              <>
                <div className="rc-metrics-grid rc-metrics-grid-sm">
                  <StatCard label="Active" value={cases.active} color="#3B82F6" />
                  <StatCard label="Pending" value={cases.pending} color="#F59E0B" />
                  <StatCard label="Closed" value={cases.closed} color="#10B981" />
                  <StatCard label="Dismissed" value={cases.dismissed} color="#EF4444" />
                </div>
                <div className="grid mt-2">
                  {casePieData.length > 0 && (
                    <ChartBox title="Status Distribution" half>
                      <ResponsiveContainer width="100%" height={260}>
                        <PieChart>
                          <Pie data={casePieData} cx="50%" cy="50%" innerRadius={60} outerRadius={90} paddingAngle={3} dataKey="value"
                            label={({ name, percent }: any) => `${name} ${(percent * 100).toFixed(0)}%`}>
                            {casePieData.map((_, idx) => <Cell key={idx} fill={PIE_COLORS[idx % PIE_COLORS.length]} />)}
                          </Pie>
                          <Tooltip contentStyle={TOOLTIP_STYLE} />
                        </PieChart>
                      </ResponsiveContainer>
                    </ChartBox>
                  )}
                  {cases.courtDistribution && cases.courtDistribution.length > 0 && (
                    <ChartBox title="Court Distribution" half>
                      <ResponsiveContainer width="100%" height={260}>
                        <BarChart data={cases.courtDistribution}>
                          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                          <XAxis dataKey="name" tick={{ ...axisTick, fontSize: 11 }} stroke="var(--text-muted)" />
                          <YAxis tick={{ ...axisTick, fontSize: 11 }} stroke="var(--text-muted)" />
                          <Tooltip contentStyle={TOOLTIP_STYLE} />
                          <Bar dataKey="count" fill="#6366F1" radius={[4, 4, 0, 0]} name="Cases" />
                        </BarChart>
                      </ResponsiveContainer>
                    </ChartBox>
                  )}
                  {cases.typeDistribution && cases.typeDistribution.length > 0 && (
                    <ChartBox title="Case Types" half>
                      <ResponsiveContainer width="100%" height={260}>
                        <BarChart data={cases.typeDistribution}>
                          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                          <XAxis dataKey="name" tick={{ ...axisTick, fontSize: 11 }} stroke="var(--text-muted)" />
                          <YAxis tick={{ ...axisTick, fontSize: 11 }} stroke="var(--text-muted)" />
                          <Tooltip contentStyle={TOOLTIP_STYLE} />
                          <Bar dataKey="count" fill="#8B5CF6" radius={[4, 4, 0, 0]} name="Cases" />
                        </BarChart>
                      </ResponsiveContainer>
                    </ChartBox>
                  )}
                </div>
              </>
            ) : (
              <div className="rc-section-empty">Case data unavailable for this period.</div>
            )}
          </Section>

          <Section title="Client Overview" onCsv={() => handleExportCsv("clients")}>
            {clients ? (
              <>
                <div className="rc-metrics-grid">
                  <MetricCard title="New Clients" value={clients.newClients?.current || 0} change={clients.newClients?.change || 0} icon="pi-users" />
                  <div className="rc-metric-card">
                    <div className="rc-metric-header">
                      <span className="rc-metric-icon"><i className="pi pi-exclamation-circle" /></span>
                      <span className="rc-metric-title">Pending Payments</span>
                    </div>
                    <div className="rc-metric-value">{formatCurrency(clients.pendingPayments?.total || 0)}</div>
                    <div className="rc-metric-sub">{clients.pendingPayments?.count || 0} invoices outstanding</div>
                  </div>
                </div>
                {clients.growth && clients.growth.length > 0 && (
                  <div className="grid mt-2">
                    <ChartBox title="Client Growth">
                      <ResponsiveContainer width="100%" height={260}>
                        <AreaChart data={clients.growth}>
                          <defs>
                            <linearGradient id="clientGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#8B5CF6" stopOpacity={0.3} /><stop offset="95%" stopColor="#8B5CF6" stopOpacity={0} /></linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                          <XAxis dataKey="month" tick={axisTick} stroke="var(--text-muted)" />
                          <YAxis tick={axisTick} stroke="var(--text-muted)" />
                          <Tooltip contentStyle={TOOLTIP_STYLE} />
                          <Area type="monotone" dataKey="count" stroke="#8B5CF6" fill="url(#clientGrad)" strokeWidth={2} name="New Clients" />
                        </AreaChart>
                      </ResponsiveContainer>
                    </ChartBox>
                  </div>
                )}
              </>
            ) : (
              <div className="rc-section-empty">Client data unavailable for this period.</div>
            )}
          </Section>

          <Section title="Hearing Overview" onCsv={() => handleExportCsv("hearings")}>
            {hearings ? (
              <>
                <div className="rc-metrics-grid rc-metrics-grid-sm">
                  <StatCard icon="pi-calendar" label="Today" value={hearings.today} color="#3B82F6" />
                  <StatCard icon="pi-clock" label="Upcoming" value={hearings.upcoming} color="#10B981" />
                  <StatCard icon="pi-times-circle" label="Missed" value={hearings.missed} color="#EF4444" />
                </div>
                {hearings.courtWise && hearings.courtWise.length > 0 && (
                  <div className="grid mt-2">
                    <ChartBox title="Court-wise Hearings">
                      <ResponsiveContainer width="100%" height={260}>
                        <BarChart data={hearings.courtWise}>
                          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                          <XAxis dataKey="name" tick={axisTick} stroke="var(--text-muted)" />
                          <YAxis tick={axisTick} stroke="var(--text-muted)" />
                          <Tooltip contentStyle={TOOLTIP_STYLE} />
                          <Bar dataKey="count" fill="#F59E0B" radius={[4, 4, 0, 0]} name="Hearings" />
                        </BarChart>
                      </ResponsiveContainer>
                    </ChartBox>
                  </div>
                )}
              </>
            ) : (
              <div className="rc-section-empty">Hearing data unavailable.</div>
            )}
          </Section>
        </>
      )}
    </div>
  );
}
