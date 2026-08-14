const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8080";

export const API = {
  BASE: API_BASE,
  AUTH: `${API_BASE}/api/auth`,
  ADVOCATES: `${API_BASE}/api/advocates`,
  CLIENTS: `${API_BASE}/api/clients`,
  CASES: `${API_BASE}/api/cases`,
  EVENTS: `${API_BASE}/api/events`,
  DOCUMENTS: `${API_BASE}/api/documents`,
  EXPENSES: `${API_BASE}/api/expenses`,
  PAYMENTS: `${API_BASE}/api/payments`,
  INVOICES: `${API_BASE}/api/invoices`,
  TASKS: `${API_BASE}/api/tasks`,
  DASHBOARD: `${API_BASE}/api/dashboard`,
  NOTIFICATIONS: `${API_BASE}/api/notifications`,
  SEARCH: `${API_BASE}/api/search`,
  AUDIT: `${API_BASE}/api/audit`,
  REPORTS: `${API_BASE}/api/reports`,
  REPORTS_CENTER: `${API_BASE}/api/reports-center`,
  COMMUNICATION: `${API_BASE}/api/communication`,
  ASSISTANT: `${API_BASE}/api/assistant`,
  BACKUP: `${API_BASE}/api/backup`,
  HEALTH: `${API_BASE}/api/health`,
};

export default API;
