import DownloadManager from "../utils/DownloadManager";

const API_BASE = `${import.meta.env.VITE_API_BASE || "http://localhost:8080"}/api/reports`;

function getToken() {
  return localStorage.getItem("token");
}

function authHeaders() {
  return { Authorization: `Bearer ${getToken()}` };
}

async function downloadPdf(url, filename) {
  DownloadManager.show("Downloading...");
  try {
    const res = await fetch(url, { headers: authHeaders() });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(objectUrl);
  } finally {
    DownloadManager.hide();
  }
}

async function openPdfInTab(url) {
  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  window.open(objectUrl, "_blank");
}

const ReportService = {
  // Existing
  downloadCases: () => downloadPdf(`${API_BASE}/cases`, "CASE_REPORT.pdf"),
  downloadClients: () => downloadPdf(`${API_BASE}/clients`, "CLIENT_REPORT.pdf"),
  downloadExpenses: () => downloadPdf(`${API_BASE}/expenses`, "EXPENSE_REPORT.pdf"),
  downloadInvoice: (id, invNum) => downloadPdf(`${API_BASE}/invoice/${id}`, `${invNum}.pdf`),
  downloadReceipt: (id) => downloadPdf(`${API_BASE}/receipt/${id}`, `RECEIPT_${id}.pdf`),

  // New
  downloadClientDetail: (id, name) =>
    downloadPdf(`${API_BASE}/client/${id}/pdf`, `CLIENT_${(name || "report").toUpperCase().replace(/\s+/g, "_")}.pdf`),

  downloadCaseDetail: (id, caseNum) =>
    downloadPdf(`${API_BASE}/case/${id}/pdf`, `CASE_${caseNum || id}.pdf`),

  downloadMonthly: (year, month) => {
    const params = new URLSearchParams();
    if (year) params.set("year", year);
    if (month) params.set("month", month);
    const name = `MONTHLY_REPORT_${year || "2026"}_${String(month || 1).padStart(2, "0")}.pdf`;
    return downloadPdf(`${API_BASE}/monthly/pdf?${params.toString()}`, name);
  },

  downloadFilteredExpenses: (filters = {}) => {
    const params = new URLSearchParams();
    if (filters.startDate) params.set("startDate", filters.startDate);
    if (filters.endDate) params.set("endDate", filters.endDate);
    if (filters.caseId) params.set("caseId", filters.caseId);
    if (filters.category) params.set("category", filters.category);
    return downloadPdf(
      `${API_BASE}/expense/pdf?${params.toString()}`,
      "EXPENSE_FILTERED_REPORT.pdf"
    );
  },

  downloadDashboard: () => downloadPdf(`${API_BASE}/dashboard/pdf`, "DASHBOARD_REPORT.pdf"),

  openClientDetail: (id) => openPdfInTab(`${API_BASE}/client/${id}/pdf`),
  openCaseDetail: (id) => openPdfInTab(`${API_BASE}/case/${id}/pdf`),
  openMonthly: (year, month) => {
    const params = new URLSearchParams();
    if (year) params.set("year", year);
    if (month) params.set("month", month);
    return openPdfInTab(`${API_BASE}/monthly/pdf?${params.toString()}`);
  },
  openDashboard: () => openPdfInTab(`${API_BASE}/dashboard/pdf`),
  openInvoice: (id) => openPdfInTab(`${API_BASE}/invoice/${id}`),
  openReceipt: (id) => openPdfInTab(`${API_BASE}/receipt/${id}`),
};

export default ReportService;
