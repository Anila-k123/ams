const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8080";

export function apiUrl(path) {
  return `${API_BASE}${path}`;
}

export function authHeaders() {
  const token = localStorage.getItem("token");
  return { Authorization: `Bearer ${token}` };
}

export async function apiFetch(path, options = {}) {
  const res = await fetch(apiUrl(path), {
    ...options,
    headers: { ...authHeaders(), ...options.headers },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "Request failed");
    throw new Error(text);
  }
  return res.json();
}

export default API_BASE;
