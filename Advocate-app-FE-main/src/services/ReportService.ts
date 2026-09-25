import DownloadManager from "../utils/DownloadManager";

import { apiUrl, authHeaders } from "../api/client";

const BASE_URL = apiUrl("/api/reports");

async function downloadPdf(url: string, filename: string) {
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

async function openPdfInTab(url: string) {
  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  window.open(objectUrl, "_blank");
}

const ReportService = {
  // Existing
  downloadCases: () => downloadPdf(`${BASE_URL}/cases`, "CASE_REPORT.pdf"),
  downloadClients: () => downloadPdf(`${BASE_URL}/clients`, "CLIENT_REPORT.pdf"),
  downloadExpenses: () => downloadPdf(`${BASE_URL}/expenses`, "EXPENSE_REPORT.pdf"),
  downloadInvoice: (id: any, invNum: any) => downloadPdf(`${BASE_URL}/invoice/${id}`, `${invNum}.pdf`),
  downloadReceipt: (id: any) => downloadPdf(`${BASE_URL}/receipt/${id}`, `RECEIPT_${id}.pdf`),

  // New
  downloadClientDetail: (id: any, name: any) =>
    downloadPdf(`${BASE_URL}/client/${id}/pdf`, `CLIENT_${(name || "report").toUpperCase().replace(/\s+/g, "_")}.pdf`),

  downloadCaseDetail: (id: any, caseNum: any) =>
    downloadPdf(`${BASE_URL}/case/${id}/pdf`, `CASE_${caseNum || id}.pdf`),

  downloadMonthly: (year: any, month: any) => {
    const params = new URLSearchParams();
    if (year) params.set("year", year);
    if (month) params.set("month", month);
    const name = `MONTHLY_REPORT_${year || "2026"}_${String(month || 1).padStart(2, "0")}.pdf`;
    return downloadPdf(`${BASE_URL}/monthly/pdf?${params.toString()}`, name);
  },

  downloadFilteredExpenses: (filters: any = {}) => {
    const params = new URLSearchParams();
    if (filters.startDate) params.set("startDate", filters.startDate);
    if (filters.endDate) params.set("endDate", filters.endDate);
    if (filters.caseId) params.set("caseId", filters.caseId);
    if (filters.category) params.set("category", filters.category);
    return downloadPdf(
      `${BASE_URL}/expense/pdf?${params.toString()}`,
      "EXPENSE_FILTERED_REPORT.pdf"
    );
  },

  downloadDashboard: () => downloadPdf(`${BASE_URL}/dashboard/pdf`, "DASHBOARD_REPORT.pdf"),

  openClientDetail: (id: any) => openPdfInTab(`${BASE_URL}/client/${id}/pdf`),
  openCaseDetail: (id: any) => openPdfInTab(`${BASE_URL}/case/${id}/pdf`),
  openMonthly: (year: any, month: any) => {
    const params = new URLSearchParams();
    if (year) params.set("year", year);
    if (month) params.set("month", month);
    return openPdfInTab(`${BASE_URL}/monthly/pdf?${params.toString()}`);
  },
  openDashboard: () => openPdfInTab(`${BASE_URL}/dashboard/pdf`),
  openInvoice: (id: any) => openPdfInTab(`${BASE_URL}/invoice/${id}`),
  openReceipt: (id: any) => openPdfInTab(`${BASE_URL}/receipt/${id}`),
};

export default ReportService;
