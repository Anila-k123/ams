// Idempotency keys for requests that must not run twice (recording a payment).
// One key per form: a double click or a retry after a timeout sends the same
// key, and the server returns the first result instead of recording again.
// A new key is taken once the save succeeds.
export function newRequestKey(): string {
  // crypto.randomUUID needs a secure context; the office LAN runs over http.
  const c: any = (globalThis as any).crypto;
  if (c?.randomUUID) {
    try { return c.randomUUID(); } catch { /* http: fall through */ }
  }
  const bytes = new Uint8Array(16);
  if (c?.getRandomValues) c.getRandomValues(bytes);
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
