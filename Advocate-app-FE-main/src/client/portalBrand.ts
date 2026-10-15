import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { apiUrl } from "../api/client";

// The firm a client portal link belongs to. Invite and sign-in links carry a
// signed firm key (?f=, clientaccess/views.py portal_key); it is remembered so a
// bookmarked /client/login without it still shows the same firm.
const KEY = "clientPortalFirm";

export type PortalBrand = { name: string; logoUrl: string | null };

function remembered() {
  try { return localStorage.getItem(KEY) || ""; } catch { return ""; }
}

/** The password-reset pages serve staff at /forgot-password... and clients at
 *  /client/forgot-password...: the same pages, with the portal's links and branding. */
export function usePortalFlow() {
  const portal = useLocation().pathname.startsWith("/client/");
  const brand = usePortalBrand(portal);
  return { portal, brand, base: portal ? "/client" : "", signIn: portal ? "/client/login" : "/login" };
}

export function usePortalBrand(enabled = true): PortalBrand | null {
  const [brand, setBrand] = useState<PortalBrand | null>(null);
  useEffect(() => {
    if (!enabled) return;
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
  }, [enabled]);
  return brand;
}
