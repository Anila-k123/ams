import { apiUrl, authHeaders } from "../api/client";

const API_PATH = "/api/dashboard";

class DashboardService {
  cache: Map<string, any>;
  activeController: AbortController | null;
  constructor() {
    this.cache = new Map();
    this.activeController = null;
  }

  cacheKey(email?: any, view?: any, date?: any, week?: any, month?: any, year?: any) {
    return `${email}-${view}-${date || ""}-${week || ""}-${month || ""}-${year || ""}`;
  }

  buildParams(view: any, date: any, week: any, month: any, year: any) {
    const params = new URLSearchParams({ view });
    if (date) params.set("date", date);
    if (week !== undefined && week !== null) params.set("week", week);
    if (month !== undefined && month !== null) params.set("month", month);
    if (year !== undefined && year !== null) params.set("year", year);
    return params.toString();
  }

  async fetchDashboard(_token: any, { view, date, week, month, year }: any, email: any) {
    const key = this.cacheKey(email, view, date, week, month, year);

    // Return cached data if available
    if (this.cache.has(key)) {
      return this.cache.get(key);
    }

    // Cancel previous request
    if (this.activeController) {
      this.activeController.abort();
    }
    this.activeController = new AbortController();
    const { signal } = this.activeController;

    try {
      const params = this.buildParams(view, date, week, month, year);
      const response = await fetch(apiUrl(`${API_PATH}?${params}`), {
        headers: authHeaders(),
        signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();

      // Cache the result
      this.cache.set(key, data);
      if (this.cache.size > 20) {
        const firstKey = this.cache.keys().next().value;
        this.cache.delete(firstKey);
      }

      return data;
    } catch (err) {
      if (err.name === "AbortError") {
        return null;
      }
      throw err;
    } finally {
      this.activeController = null;
    }
  }

  invalidateCache(email?: any, view?: any, date?: any, week?: any, month?: any, year?: any) {
    const key = this.cacheKey(email, view, date, week, month, year);
    this.cache.delete(key);
  }

  clearAllCache() {
    this.cache.clear();
  }
}

const dashboardService = new DashboardService();
export default dashboardService;
