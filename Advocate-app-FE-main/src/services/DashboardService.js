const API_BASE = `${import.meta.env.VITE_API_BASE || "http://localhost:8080"}/api/dashboard`;

class DashboardService {
  constructor() {
    this.cache = new Map();
    this.activeController = null;
  }

  cacheKey(email, view, date, week, month, year) {
    return `${email}-${view}-${date || ""}-${week || ""}-${month || ""}-${year || ""}`;
  }

  buildParams(view, date, week, month, year) {
    const params = new URLSearchParams({ view });
    if (date) params.set("date", date);
    if (week !== undefined && week !== null) params.set("week", week);
    if (month !== undefined && month !== null) params.set("month", month);
    if (year !== undefined && year !== null) params.set("year", year);
    return params.toString();
  }

  async fetchDashboard(token, { view, date, week, month, year }, email) {
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
      const response = await fetch(`${API_BASE}?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
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

  invalidateCache(email, view, date, week, month, year) {
    const key = this.cacheKey(email, view, date, week, month, year);
    this.cache.delete(key);
  }

  clearAllCache() {
    this.cache.clear();
  }
}

const dashboardService = new DashboardService();
export default dashboardService;
