import { useEffect, useState } from "react";
import { apiUrl } from "../api/client";

// The firm a client portal link belongs to. Invite and sign-in links carry a
// signed firm key (?f=, clientaccess/views.py portal_key); it is remembered so a
// bookmarked /client/login without it still shows the same firm.
const KEY = "clientPortalFirm";

export type PortalBrand = { name: string; logoUrl: string | null };

function remembered() {
  try { return localStorage.getItem(KEY) || ""; } catch { return ""; }
}

export function usePortalBrand(): PortalBrand | null {
  const [brand, setBrand] = useState<PortalBrand | null>(null);
  useEffect(() => {
    const fromLink = new URLSearchParams(window.location.search).get("f") || "";
    const key = fromLink || remembered();
    if (!key) return;
    let alive = true;
    fetch(apiUrl(`/api/client-auth/branding?f=${encodeURIComponent(key)}`))
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => {
        if (!alive) return;
        try {
          if (b) localStorage.setItem(KEY, key);
          else if (!fromLink) localStorage.removeItem(KEY);   // a stale key: forget it
        } catch { /* storage unavailable */ }
        setBrand(b);
      })
      .catch(() => { /* offline: the generic portal look is fine */ });
    return () => { alive = false; };
  }, []);
  return brand;
}
