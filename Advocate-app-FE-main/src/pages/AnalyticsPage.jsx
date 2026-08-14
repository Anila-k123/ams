import React, { useState, useEffect } from "react";
import axios from "axios";
import { FiDownload, FiBarChart2, FiPieChart, FiTrendingUp, FiCalendar } from "react-icons/fi";
import ReportService from "../services/ReportService";
import { SkeletonPage } from "../components/Skeleton";
import { useLoading } from "../contexts/LoadingContext";
import { useToast } from "../contexts/ToastContext";
import { formatCurrency } from "../utils/formatCurrency";
import "../assets/styles/AnalyticsPage.css";

export default function AnalyticsPage() {
  const { withLoading } = useLoading();
  const { error } = useToast();
  const [caseStatus, setCaseStatus] = useState({});
  const [caseCategory, setCaseCategory] = useState({});
  const [incomeExpense, setIncomeExpense] = useState([]);
  const [clientGrowth, setClientGrowth] = useState([]);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState("");

  const token = localStorage.getItem("token");

  useEffect(() => {
    const fetchData = async () => {
      try {
        const headers = { Authorization: `Bearer ${token}` };
        const [statusRes, catRes, ieRes, growthRes] = await Promise.all([
          axios.get("/api/dashboard/charts/case-status", { headers }),
          axios.get("/api/dashboard/charts/case-category", { headers }),
          axios.get("/api/dashboard/charts/income-vs-expense", { headers }),
          axios.get("/api/dashboard/charts/client-growth", { headers })
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
  }, [token]);

  const handleDownloadPDF = async (reportType) => {
    setDownloading(reportType);
    try {
      const response = await withLoading(
        axios.get(`/api/reports/${reportType}`, {
          headers: { Authorization: `Bearer ${token}` },
          responseType: "blob"
        }),
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
      await withLoading(
        ReportService.downloadMonthly(now.getFullYear(), now.getMonth() + 1),
        "Generating Report..."
      );
    } catch (err) {
      console.error("Error downloading monthly report:", err);
      error("Failed to download monthly PDF.");
    }
  };

  const handleDashboardPdf = async () => {
    try {
      await withLoading(
        ReportService.downloadDashboard(),
        "Generating Report..."
      );
    } catch (err) {
      console.error("Error downloading dashboard report:", err);
      error("Failed to download dashboard PDF.");
    }
  };

  if (loading) {
    return <SkeletonPage />;
  }

  // Helper values for line chart
  const maxFinanceVal = Math.max(
    10000,
    ...incomeExpense.map(d => Math.max(d.income, d.expense))
  );

  return (
    <div className="analytics-container">
      <div className="analytics-header">
        <div>
          <h2>📊 Reports & Analytics</h2>
          <p className="subtle">Analyze practices, financial summaries, and download reports</p>
        </div>
      </div>

      {/* Row 1: PDF Downloads */}
      <div className="reports-grid">
        <div className="report-download-card">
          <div className="report-icon-box cases">💼</div>
          <div className="report-info">
            <h3>Case List Report</h3>
            <p>Export all cases list with titles, categories, next hearings, and statuses.</p>
          </div>
          <button onClick={() => handleDownloadPDF("cases")} disabled={downloading === "cases"}>
            {downloading === "cases" ? "Exporting..." : <><FiDownload /> Download PDF</>}
          </button>
        </div>

        <div className="report-download-card">
          <div className="report-icon-box clients">👥</div>
          <div className="report-info">
            <h3>Client Directory</h3>
            <p>Export list of all clients with phone numbers, emails, addresses, and case tallies.</p>
          </div>
          <button onClick={() => handleDownloadPDF("clients")} disabled={downloading === "clients"}>
            {downloading === "clients" ? "Exporting..." : <><FiDownload /> Download PDF</>}
          </button>
        </div>

        <div className="report-download-card">
          <div className="report-icon-box expenses">💵</div>
          <div className="report-info">
            <h3>Expense Statement</h3>
            <p>Export practice expenses, categories, payment dates, and payment modes.</p>
          </div>
          <button onClick={() => handleDownloadPDF("expenses")} disabled={downloading === "expenses"}>
            {downloading === "expenses" ? "Exporting..." : <><FiDownload /> Download PDF</>}
          </button>
        </div>

        <div className="report-download-card">
          <div className="report-icon-box monthly">📅</div>
          <div className="report-info">
            <h3>Monthly Report</h3>
            <p>Export clients, cases, financials, and activity summary for a selected month.</p>
          </div>
          <button onClick={() => handleMonthlyPdf()}>
            <FiCalendar /> Monthly PDF
          </button>
        </div>

        <div className="report-download-card">
          <div className="report-icon-box dashboard">📊</div>
          <div className="report-info">
            <h3>Dashboard Report</h3>
            <p>Export a complete dashboard overview with financials, case distribution, and more.</p>
          </div>
          <button onClick={() => handleDashboardPdf()}>
            <FiDownload /> Dashboard PDF
          </button>
        </div>
      </div>

      {/* Row 2: Charts */}
      <div className="charts-grid-main">
        {/* Income vs Expenses Line Chart */}
        <div className="analytics-chart-card">
          <div className="chart-header-row">
            <h4><FiTrendingUp /> Monthly Income vs Expenses</h4>
          </div>
          <div className="line-chart-svg-container">
            <svg viewBox="0 0 500 200" className="svg-chart">
              {/* Grids */}
              <line x1="40" y1="20" x2="480" y2="20" stroke="var(--border-color)" strokeDasharray="3" />
              <line x1="40" y1="70" x2="480" y2="70" stroke="var(--border-color)" strokeDasharray="3" />
              <line x1="40" y1="120" x2="480" y2="120" stroke="var(--border-color)" strokeDasharray="3" />
              <line x1="40" y1="170" x2="480" y2="170" stroke="#cbd5e1" />

              {/* Labels on Y */}
              <text x="35" y="24" textAnchor="end" className="chart-txt">{formatCurrency(maxFinanceVal)}</text>
              <text x="35" y="74" textAnchor="end" className="chart-txt">{formatCurrency(maxFinanceVal / 2)}</text>
              <text x="35" y="174" textAnchor="end" className="chart-txt">₹0</text>

              {/* Lines & Plots */}
              {incomeExpense.map((d, i) => {
                const x = 60 + i * 100;
                const incomeY = 170 - (d.income / maxFinanceVal) * 150;
                const expenseY = 170 - (d.expense / maxFinanceVal) * 150;

                // Build line string connection
                const prev = incomeExpense[i - 1];
                const prevX = 60 + (i - 1) * 100;
                const prevIncomeY = prev ? 170 - (prev.income / maxFinanceVal) * 150 : 170;
                const prevExpenseY = prev ? 170 - (prev.expense / maxFinanceVal) * 150 : 170;

                return (
                  <g key={i}>
                    {i > 0 && (
                      <>
                        {/* Income Segment */}
                        <line x1={prevX} y1={prevIncomeY} x2={x} y2={incomeY} stroke="#10b981" strokeWidth="3" />
                        {/* Expense Segment */}
                        <line x1={prevX} y1={prevExpenseY} x2={x} y2={expenseY} stroke="#ef4444" strokeWidth="3" />
                      </>
                    )}
                    {/* Dots */}
                    <circle cx={x} cy={incomeY} r="4" fill="#10b981" />
                    <circle cx={x} cy={expenseY} r="4" fill="#ef4444" />
                    {/* X labels */}
                    <text x={x} y="190" textAnchor="middle" className="chart-txt">{d.month}</text>
                  </g>
                );
              })}
            </svg>
            <div className="chart-legends">
              <span className="legend-item"><span className="legend-dot green" /> Income</span>
              <span className="legend-item"><span className="legend-dot red" /> Expense</span>
            </div>
          </div>
        </div>

        {/* Case Category Bar Chart */}
        <div className="analytics-chart-card">
          <div className="chart-header-row">
            <h4><FiBarChart2 /> Cases by Category</h4>
          </div>
          <div className="bar-chart-container">
            {Object.keys(caseCategory).length === 0 ? (
              <p className="no-data">No category data recorded.</p>
            ) : (
              <div className="bars-list">
                {Object.entries(caseCategory).map(([cat, count], i) => {
                  const maxCount = Math.max(1, ...Object.values(caseCategory));
                  const percent = (count / maxCount) * 100;
                  return (
                    <div key={i} className="bar-item-row">
                      <span className="bar-label">{cat}</span>
                      <div className="bar-track">
                        <div className="bar-fill" style={{ width: `${percent}%` }} />
                      </div>
                      <span className="bar-val">{count}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
