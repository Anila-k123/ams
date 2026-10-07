// Copy text to the clipboard from any page.
// navigator.clipboard only exists in a secure context (https or localhost). The
// office opens AMS over plain http on the LAN (http://192.168.x.x:5173), where it
// is undefined, so every copy button failed there. The fallback copies through a
// hidden textarea with execCommand, which browsers still allow on http.
export async function copyText(text: string): Promise<boolean> {
  if (window.isSecureContext && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch { /* permission refused: try the fallback */ }
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  // Off-screen but focusable; inside an open dialog so its focus trap keeps it.
  ta.style.position = 'fixed';
  ta.style.top = '-1000px';
  ta.style.opacity = '0';
  const host = document.querySelector('[data-rt-dialog]') || document.body;
  const back = document.activeElement as HTMLElement | null;
  host.appendChild(ta);
  ta.focus();
  ta.select();
  ta.setSelectionRange(0, text.length);
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  ta.remove();
  back?.focus?.();
  return ok;
}
