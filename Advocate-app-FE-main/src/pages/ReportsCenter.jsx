import React, { useState, useEffect, useCallback } from "react";
import {
  PieChart, Pie, Cell, BarChart, Bar, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from "recharts";
import {
  FiDollarSign, FiTrendingUp, FiTrendingDown, FiAlertCircle,
  FiDownload, FiFileText, FiCalendar, FiUsers, FiBriefcase,
  FiClock, FiCheckCircle, FiXCircle
} from "react-icons/fi";
import { useLoading } from "../contexts/LoadingContext";
import { formatCurrency } from "../utils/formatCurrency";
import ReportService from "../services/ReportService";
import { useDownload } from "../hooks/useDownload";
import DownloadLoader from "../components/DownloadLoader";
import "../assets/styles/ReportsCenter.css";

const API_BASE = `${import.meta.env.VITE_API_BASE || "http://localhost:8080"}/api/reports-center`;

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

const STATUS_COLORS = { Active: "#3B82F6", Pending: "#F59E0B", Closed: "#10B981", Dismissed: "#EF4444" };
const PIE_COLORS = ["#3B82F6", "#F59E0B", "#10B981", "#EF4444"];

function MetricCard({ title, value, previous, change, icon, format }) {
  const isPositive = change >= 0;
  const displayValue = format === "currency" ? formatCurrency(value) : value;
  return (
    <div className="rc-metric-card">
      <div className="rc-metric-header">
        <span className="rc-metric-icon">{icon}</span>
        <span className="rc-metric-title">{title}</span>
      </div>
      <div className="rc-metric-value">{displayValue}</div>
      <div className={`rc-metric-change ${isPositive ? "positive" : "negative"}`}>
        {isPositive ? <FiTrendingUp /> : <FiTrendingDown />}
        <span>{Math.abs(change)}% vs previous period</span>
      </div>
    </div>
  );
}

function SectionHeader({ title, children }) {
  return (
    <div className="rc-section-header">
      <h3 className="rc-section-title">{title}</h3>
      <div className="rc-section-actions">{children}</div>
    </div>
  );
}

function ExportBtn({ label, onClick, icon }) {
  return (
    <button className="rc-export-btn" onClick={onClick}>
      {icon || <FiDownload />}
      <span>{label}</span>
    </button>
  );
}

export default function ReportsCenter() {
  const { withLoading } = useLoading();
  const { isDownloading, withDownload } = useDownload();
  const [filter, setFilter] = useState("this-month");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem("token");
      let url = `${API_BASE}?filter=${filter}`;
      if (filter === "custom" && customStart && customEnd) {
        url += `&startDate=${customStart}&endDate=${customEnd}`;
      }
      const res = await withLoading(
        fetch(url, { headers: { Authorization: `Bearer ${token}` } }),
        "Loading reports..."
      );
      if (!res.ok) throw new Error("Failed to fetch reports");
      const json = await res.json();
      setData(json);
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

  const handleExportCsv = async (section) => {
    await withDownload(async () => {
      const token = localStorage.getItem("token");
      let url = `${API_BASE}/export/csv?section=${section}&filter=${filter}`;
      if (filter === "custom" && customStart && customEnd) {
        url += `&startDate=${customStart}&endDate=${customEnd}`;
      }
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
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
    await withDownload(
      ReportService.downloadDashboard(),
      "Exporting PDF..."
    );
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
  ].filter(d => d.value > 0) : [];

  return (
    <div className="reports-center">
      {isDownloading && <DownloadLoader message="Exporting..." />}
      <div className="rc-header">
        <div>
          <h1 className="rc-page-title">Reports & Analytics</h1>
          <p className="rc-page-subtitle">Comprehensive insights into your practice</p>
        </div>
        <div className="rc-header-right">
          <div className="rc-filter-group">
            <select className="rc-filter-select" value={filter} onChange={(e) => setFilter(e.target.value)}>
              {FILTERS.map((f) => (
                <option key={f.value} value={f.value}>{f.label}</option>
              ))}
            </select>
            {filter === "custom" && (
              <div className="rc-custom-dates">
                <input type="date" className="rc-date-input" value={customStart} onChange={(e) => setCustomStart(e.target.value)} />
                <span>to</span>
                <input type="date" className="rc-date-input" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} />
              </div>
            )}
          </div>
          <ExportBtn label="Export PDF" onClick={handleExportPdf} icon={<FiFileText />} />
        </div>
      </div>

      {loading && (
        <div className="rc-loading">
          <div className="rc-spinner" />
          <span>Loading reports...</span>
        </div>
      )}

      {!loading && !data && (
        <div className="rc-empty">
          <FiAlertCircle className="rc-empty-icon" />
          <h3>No data available</h3>
          <p>Try adjusting the date filter.</p>
        </div>
      )}

      {!loading && data && (
        <>
          {/* Financial */}
          <section className="rc-section">
            <SectionHeader title="Financial Overview">
              <ExportBtn label="CSV" onClick={() => handleExportCsv("financial")} />
            </SectionHeader>
            {fin ? (
              <>
                <div className="rc-metrics-grid">
                  <MetricCard title="Revenue" value={fin.revenue?.current || 0} previous={fin.revenue?.previous} change={fin.revenue?.change || 0} icon={<FiDollarSign />} format="currency" />
                  <MetricCard title="Expenses" value={fin.expenses?.current || 0} previous={fin.expenses?.previous} change={fin.expenses?.change || 0} icon={<FiTrendingDown />} format="currency" />
                  <MetricCard title="Net Income" value={fin.netIncome?.current || 0} previous={fin.netIncome?.previous} change={fin.netIncome?.change || 0} icon={<FiTrendingUp />} format="currency" />
                  <MetricCard title="Outstanding" value={fin.outstandingPayments?.total || 0} previous={0} change={0} icon={<FiAlertCircle />} format="currency" />
                </div>
                {fin.cashFlow && fin.cashFlow.length > 0 && (
                  <div className="rc-chart-container">
                    <h4 className="rc-chart-title">Cash Flow</h4>
                    <ResponsiveContainer width="100%" height={280}>
                      <AreaChart data={fin.cashFlow}>
                        <defs>
                          <linearGradient id="incomeGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#10B981" stopOpacity={0.3}/><stop offset="95%" stopColor="#10B981" stopOpacity={0}/></linearGradient>
                          <linearGradient id="expenseGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#EF4444" stopOpacity={0.3}/><stop offset="95%" stopColor="#EF4444" stopOpacity={0}/></linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                        <XAxis dataKey="month" tick={{ fontSize: 12 }} stroke="var(--text-muted)" />
                        <YAxis tick={{ fontSize: 12 }} stroke="var(--text-muted)" />
                        <Tooltip contentStyle={{ background: "var(--card-bg)", border: "1px solid var(--border-color)", borderRadius: 8 }} />
                        <Legend />
                        <Area type="monotone" dataKey="income" stroke="#10B981" fill="url(#incomeGrad)" strokeWidth={2} name="Income" />
                        <Area type="monotone" dataKey="expense" stroke="#EF4444" fill="url(#expenseGrad)" strokeWidth={2} name="Expenses" />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </>
            ) : (
              <div className="rc-section-empty">Financial data unavailable for this period.</div>
            )}
          </section>

          {/* Cases */}
          <section className="rc-section">
            <SectionHeader title="Case Overview">
              <ExportBtn label="CSV" onClick={() => handleExportCsv("cases")} />
            </SectionHeader>
            {cases ? (
              <>
                <div className="rc-metrics-grid rc-metrics-grid-sm">
                  <div className="rc-stat-card"><span className="rc-stat-label">Active</span><span className="rc-stat-value" style={{ color: "#3B82F6" }}>{cases.active}</span></div>
                  <div className="rc-stat-card"><span className="rc-stat-label">Pending</span><span className="rc-stat-value" style={{ color: "#F59E0B" }}>{cases.pending}</span></div>
                  <div className="rc-stat-card"><span className="rc-stat-label">Closed</span><span className="rc-stat-value" style={{ color: "#10B981" }}>{cases.closed}</span></div>
                  <div className="rc-stat-card"><span className="rc-stat-label">Dismissed</span><span className="rc-stat-value" style={{ color: "#EF4444" }}>{cases.dismissed}</span></div>
                </div>
                <div className="rc-charts-row">
                  {casePieData.length > 0 && (
                    <div className="rc-chart-container rc-chart-half">
                      <h4 className="rc-chart-title">Status Distribution</h4>
                      <ResponsiveContainer width="100%" height={260}>
                        <PieChart>
                          <Pie data={casePieData} cx="50%" cy="50%" innerRadius={60} outerRadius={90} paddingAngle={3} dataKey="value" label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                            {casePieData.map((entry, idx) => <Cell key={idx} fill={PIE_COLORS[idx % PIE_COLORS.length]} />)}
                          </Pie>
                          <Tooltip />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                  {cases.courtDistribution && cases.courtDistribution.length > 0 && (
                    <div className="rc-chart-container rc-chart-half">
                      <h4 className="rc-chart-title">Court Distribution</h4>
                      <ResponsiveContainer width="100%" height={260}>
                        <BarChart data={cases.courtDistribution}>
                          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                          <XAxis dataKey="name" tick={{ fontSize: 11 }} stroke="var(--text-muted)" />
                          <YAxis tick={{ fontSize: 11 }} stroke="var(--text-muted)" />
                          <Tooltip contentStyle={{ background: "var(--card-bg)", border: "1px solid var(--border-color)", borderRadius: 8 }} />
                          <Bar dataKey="count" fill="#6366F1" radius={[4, 4, 0, 0]} name="Cases" />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                  {cases.typeDistribution && cases.typeDistribution.length > 0 && (
                    <div className="rc-chart-container rc-chart-half">
                      <h4 className="rc-chart-title">Case Types</h4>
                      <ResponsiveContainer width="100%" height={260}>
                        <BarChart data={cases.typeDistribution}>
                          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                          <XAxis dataKey="name" tick={{ fontSize: 11 }} stroke="var(--text-muted)" />
                          <YAxis tick={{ fontSize: 11 }} stroke="var(--text-muted)" />
                          <Tooltip contentStyle={{ background: "var(--card-bg)", border: "1px solid var(--border-color)", borderRadius: 8 }} />
                          <Bar dataKey="count" fill="#8B5CF6" radius={[4, 4, 0, 0]} name="Cases" />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="rc-section-empty">Case data unavailable for this period.</div>
            )}
          </section>

          {/* Clients */}
          <section className="rc-section">
            <SectionHeader title="Client Overview">
              <ExportBtn label="CSV" onClick={() => handleExportCsv("clients")} />
            </SectionHeader>
            {clients ? (
              <>
                <div className="rc-metrics-grid">
                  <MetricCard title="New Clients" value={clients.newClients?.current || 0} previous={clients.newClients?.previous} change={clients.newClients?.change || 0} icon={<FiUsers />} />
                  <div className="rc-metric-card">
                    <div className="rc-metric-header"><span className="rc-metric-icon"><FiAlertCircle /></span><span className="rc-metric-title">Pending Payments</span></div>
                    <div className="rc-metric-value">{formatCurrency(clients.pendingPayments?.total || 0)}</div>
                    <div className="rc-metric-sub">{clients.pendingPayments?.count || 0} invoices outstanding</div>
                  </div>
                </div>
                {clients.growth && clients.growth.length > 0 && (
                  <div className="rc-chart-container">
                    <h4 className="rc-chart-title">Client Growth</h4>
                    <ResponsiveContainer width="100%" height={260}>
                      <AreaChart data={clients.growth}>
                        <defs>
                          <linearGradient id="clientGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#8B5CF6" stopOpacity={0.3}/><stop offset="95%" stopColor="#8B5CF6" stopOpacity={0}/></linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                        <XAxis dataKey="month" tick={{ fontSize: 12 }} stroke="var(--text-muted)" />
                        <YAxis tick={{ fontSize: 12 }} stroke="var(--text-muted)" />
                        <Tooltip contentStyle={{ background: "var(--card-bg)", border: "1px solid var(--border-color)", borderRadius: 8 }} />
                        <Area type="monotone" dataKey="count" stroke="#8B5CF6" fill="url(#clientGrad)" strokeWidth={2} name="New Clients" />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </>
            ) : (
              <div className="rc-section-empty">Client data unavailable for this period.</div>
            )}
          </section>

          {/* Hearings */}
          <section className="rc-section">
            <SectionHeader title="Hearing Overview">
              <ExportBtn label="CSV" onClick={() => handleExportCsv("hearings")} />
            </SectionHeader>
            {hearings ? (
              <>
                <div className="rc-metrics-grid rc-metrics-grid-sm">
                  <div className="rc-stat-card"><FiCalendar className="rc-stat-icon" style={{ color: "#3B82F6" }} /><span className="rc-stat-label">Today</span><span className="rc-stat-value" style={{ color: "#3B82F6" }}>{hearings.today}</span></div>
                  <div className="rc-stat-card"><FiClock className="rc-stat-icon" style={{ color: "#10B981" }} /><span className="rc-stat-label">Upcoming</span><span className="rc-stat-value" style={{ color: "#10B981" }}>{hearings.upcoming}</span></div>
                  <div className="rc-stat-card"><FiXCircle className="rc-stat-icon" style={{ color: "#EF4444" }} /><span className="rc-stat-label">Missed</span><span className="rc-stat-value" style={{ color: "#EF4444" }}>{hearings.missed}</span></div>
                </div>
                {hearings.courtWise && hearings.courtWise.length > 0 && (
                  <div className="rc-chart-container">
                    <h4 className="rc-chart-title">Court-wise Hearings</h4>
                    <ResponsiveContainer width="100%" height={260}>
                      <BarChart data={hearings.courtWise}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                        <XAxis dataKey="name" tick={{ fontSize: 12 }} stroke="var(--text-muted)" />
                        <YAxis tick={{ fontSize: 12 }} stroke="var(--text-muted)" />
                        <Tooltip contentStyle={{ background: "var(--card-bg)", border: "1px solid var(--border-color)", borderRadius: 8 }} />
                        <Bar dataKey="count" fill="#F59E0B" radius={[4, 4, 0, 0]} name="Hearings" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </>
            ) : (
              <div className="rc-section-empty">Hearing data unavailable.</div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
