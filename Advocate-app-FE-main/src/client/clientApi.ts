import { apiUrl, authHeaders } from "../api/client";
import { logoutAndRedirect } from "../utils/auth";

// The Client role's API (/api/client/*), with the normal AMS login token. The backend
// refuses every other endpoint for client users, so this is all the client view uses.
export async function clientGet(path: string, { blob = false, method = "GET", body }: { blob?: boolean; method?: string; body?: any } = {}): Promise<any> {
  const res = await fetch(apiUrl(`/api/client/${path}`), {
    method,
    headers: { ...authHeaders(), ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) {
    logoutAndRedirect();
    throw new Error("Session expired");
  }
  if (!res.ok) {
    const data: any = await res.json().catch(() => ({}));
    throw new Error(data.error || "Could not load this. Please try again.");
  }
  return blob ? res.blob() : res.json();
}

/** Download (or open) a protected file with the session. */
export async function clientDownload(path: string, filename: string, { open = false }: { open?: boolean } = {}) {
  const blob = await clientGet(path, { blob: true });
  const url = URL.createObjectURL(blob);
  if (open) {
    window.open(url, "_blank", "noopener");
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    return;
  }
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

/** Change password uses the normal AMS profile endpoint (allowlisted for clients). */
export async function changePassword(currentPassword: string, newPassword: string) {
  const res = await fetch(apiUrl("/api/profile/change-password"), {
    method: "PUT", headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ currentPassword, newPassword, confirmNewPassword: newPassword }),
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || data.message || "Could not change the password.");
  return data;
}

export const inr = (n: any) => (n == null ? "—" : `₹${Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`);
export const fmtDate = (d: any) => (d ? new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—");
