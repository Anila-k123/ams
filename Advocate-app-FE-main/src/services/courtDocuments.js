import { apiUrl } from "../api";

// Fetch ONE court document via the AMS streaming proxy. Nothing is stored server-side.
// - kind "order_pdf": downloads the PDF to the user's device, returns null.
// - kind "hearing_business": returns the parsed Daily Status object for a modal.
// Throws Error (with .status) on failure.
export async function fetchCourtDocument({ courtComplex, viewToken, kind, token, label }) {
  const jwt = localStorage.getItem("token");
  const res = await fetch(apiUrl("/api/courtsearch/ecourts/document"), {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}` },
    body: JSON.stringify({ court_complex: courtComplex || "", view_token: viewToken, kind, token }),
  });
  if (!res.ok) {
    const err = new Error(res.status === 404
      ? "No document was uploaded for this item."
      : "Couldn’t fetch the document. Please try again.");
    err.status = res.status;
    throw err;
  }
  if (kind === "order_pdf") {
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(label || "order").replace(/[\\/:*?"<>|]+/g, "_")}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    return null;
  }
  const data = await res.json();
  return data.business || data;
}

// Download a High Court order/judgement PDF by its (absolute) URL, via the AMS
// streaming proxy. Saves the file to the user's device; returns null.
// Throws Error (with .status) on failure.
export async function downloadHcOrderPdf(url, label) {
  const jwt = localStorage.getItem("token");
  const res = await fetch(apiUrl("/api/courtsearch/hc/order-pdf"), {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}` },
    body: JSON.stringify({ url }),
  });
  if (!res.ok) {
    const err = new Error(res.status === 404
      ? "No PDF was uploaded for this order."
      : "Couldn’t fetch the order PDF. Please try again.");
    err.status = res.status;
    throw err;
  }
  const blob = await res.blob();
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = `${(label || "order").replace(/[\\/:*?"<>|]+/g, "_")}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(href);
  return null;
}
