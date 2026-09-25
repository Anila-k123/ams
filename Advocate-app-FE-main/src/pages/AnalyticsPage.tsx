import { useState, useEffect } from "react";
import { Button } from "primereact/button";
import { Card } from "primereact/card";
import { Skeleton } from "primereact/skeleton";
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";
import api from "../api/client";
import ReportService from "../services/ReportService";
import { useLoading } from "../contexts/LoadingContext";
import { useToast } from "../contexts/ToastContext";
import { formatCurrency } from "../utils/formatCurrency";
import "../assets/styles/AnalyticsPage.css";

const PDF_REPORTS = [
  { type: "cases", icon: "pi-briefcase", title: "Case List Report", desc: "Export all cases list with titles, categories, next hearings, and statuses." },
  { type: "clients", icon: "pi-users", title: "Client Directory", desc: "Export list of all clients with phone numbers, emails, addresses, and case tallies." },
  { type: "expenses", icon: "pi-wallet", title: "Expense Statement", desc: "Export practice expenses, categories, payment dates, and payment modes." },
];

export default function AnalyticsPage() {
  const { withLoading } = useLoading() as any;
  const { error } = useToast() as any;
  // case-status is still fetched (same calls as before) though no chart shows it yet.
  const [, setCaseStatus] = useState<any>({});
  const [caseCategory, setCaseCategory] = useState<Record<string, number>>({});
  const [incomeExpense, setIncomeExpense] = useState<any[]>([]);
  const [, setClientGrowth] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState("");

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [statusRes, catRes, ieRes, growthRes] = await Promise.all([
          api.get("/api/dashboard/charts/case-status"),
          api.get("/api/dashboard/charts/case-category"),
          api.get("/api/dashboard/charts/income-vs-expense"),
          api.get("/api/dashboard/charts/client-growth"),
        ]);
        setCaseStatus(statusRes.data || {});
        setCaseCategory(catRes.data || {});
        setIncomeExpense(ieRes.data || []);
        setClientGrowth(growthRes.data || []);
      } catch (err) {
        console.error("Error fetching analytics data:", err);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  const handleDownloadPDF = async (reportType: string) => {
    setDownloading(reportType);
    try {
      const response = await withLoading(
        api.get(`/api/reports/${reportType}`, { responseType: "blob" }),
        "Exporting..."
      );
      const blob = new Blob([response.data], { type: "application/pdf" });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", `${reportType}_report.pdf`);
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (err) {
      console.error(`Error downloading ${reportType} report:`, err);
      error("Failed to download PDF report.");
    } finally {
      setDownloading("");
    }
  };

  const handleMonthlyPdf = async () => {
    const now = new Date();
    try {
      await withLoading((ReportService as any).downloadMonthly(now.getFullYear(), now.getMonth() + 1), "Generating Report...");
    } catch (err) {
      console.error("Error downloading monthly report:", err);
      error("Failed to download monthly PDF.");
    }
  };

  const handleDashboardPdf = async () => {
    try {
      await withLoading((ReportService as any).downloadDashboard(), "Generating Report...");
    } catch (err) {
      console.error("Error downloading dashboard report:", err);
      error("Failed to download dashboard PDF.");
    }
  };

  if (loading) {
    return (
      <div className="an-container">
        <Skeleton width="40%" height="2rem" className="mb-3" />
        <div className="an-reports-grid mb-4">{[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} height="170px" />)}</div>
        <div className="grid">
          <div className="col-12 lg:col-6"><Skeleton height="300px" /></div>
          <div className="col-12 lg:col-6"><Skeleton height="300px" /></div>
        </div>
      </div>
    );
  }

  const categoryData = Object.entries(caseCategory).map(([name, count]) => ({ name, count }));

  const reportCard = (icon: string, title: string, desc: string, button: any, key: string) => (
    <Card key={key} className="an-report-card">
      <div className="an-report-icon"><i className={`pi ${icon}`} /></div>
      <h3>{title}</h3>
      <p>{desc}</p>
      {button}
    </Card>
  );

  return (
    <div className="an-container">
      <div className="mb-4">
        <h2 className="an-title"><i className="pi pi-chart-bar mr-2" />Reports &amp; Analytics</h2>
        <p className="an-subtle">Analyze practices, financial summaries, and download reports</p>
      </div>

      <div className="an-reports-grid mb-4">
        {PDF_REPORTS.map((r) => reportCard(r.icon, r.title, r.desc,
          <Button size="small" icon="pi pi-download" label={downloading === r.type ? "Exporting..." : "Download PDF"}
            disabled={downloading === r.type} onClick={() => handleDownloadPDF(r.type)} />, r.type))}
        {reportCard("pi-calendar", "Monthly Report", "Export clients, cases, financials, and activity summary for a selected month.",
          <Button size="small" icon="pi pi-calendar" label="Monthly PDF" onClick={() => handleMonthlyPdf()} />, "monthly")}
        {reportCard("pi-chart-pie", "Dashboard Report", "Export a complete dashboard overview with financials, case distribution, and more.",
          <Button size="small" icon="pi pi-download" label="Dashboard PDF" onClick={() => handleDashboardPdf()} />, "dashboard")}
      </div>

      <div className="grid">
        <div className="col-12 lg:col-6">
          <Card title={<span className="an-chart-title"><i className="pi pi-chart-line mr-2" />Monthly Income vs Expenses</span>}>
            <div style={{ width: "100%", height: 260 }}>
              <ResponsiveContainer>
                <LineChart data={incomeExpense} margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                  <XAxis dataKey="month" tick={{ fill: "var(--text-muted)", fontSize: 12 }} />
                  <YAxis tickFormatter={(v) => formatCurrency(v)} tick={{ fill: "var(--text-muted)", fontSize: 11 }} width={80} />
                  <Tooltip formatter={(v: any) => formatCurrency(v)}
                    contentStyle={{ background: "var(--card-bg)", border: "1px solid var(--border-color)", color: "var(--text-primary)" }} />
                  <Legend />
                  <Line type="monotone" dataKey="income" name="Income" stroke="var(--success)" strokeWidth={3} dot={{ r: 4 }} />
                  <Line type="monotone" dataKey="expense" name="Expense" stroke="var(--danger)" strokeWidth={3} dot={{ r: 4 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </div>

        <div className="col-12 lg:col-6">
          <Card title={<span className="an-chart-title"><i className="pi pi-chart-bar mr-2" />Cases by Category</span>}>
            {categoryData.length === 0 ? (
              <p className="an-subtle">No category data recorded.</p>
            ) : (
              <div style={{ width: "100%", height: Math.max(200, categoryData.length * 36) }}>
                <ResponsiveContainer>
                  <BarChart data={categoryData} layout="vertical" margin={{ top: 4, right: 24, left: 8, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" horizontal={false} />
                    <XAxis type="number" allowDecimals={false} tick={{ fill: "var(--text-muted)", fontSize: 12 }} />
                    <YAxis type="category" dataKey="name" width={120} tick={{ fill: "var(--text-secondary)", fontSize: 12 }} />
                    <Tooltip cursor={{ fill: "color-mix(in srgb, var(--primary) 8%, transparent)" }}
                      contentStyle={{ background: "var(--card-bg)", border: "1px solid var(--border-color)", color: "var(--text-primary)" }} />
                    <Bar dataKey="count" name="Cases" fill="var(--primary)" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
