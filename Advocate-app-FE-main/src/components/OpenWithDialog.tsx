import { useCallback, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { errorMessage } from "../api/client";
import { useToast } from "../contexts/ToastContext";
import { Button } from "../ui/kit";
import { Check } from "../ui/forms";
import { Modal } from "../ui/overlays";
import {
  desktopLink, desktopLinks, isMobile, launch, markWorked, openPrefs, rememberOpener,
  type DesktopLinks, type Opener,
} from "../utils/openWith";

// The PactPro editor: a page to go to, or (the draft page, already there) a function that shows it again.
type Fallback = string | (() => void);
type Pending = { links: DesktopLinks; pactproUrl: Fallback };
type OpenDocument = (kind: "doc" | "draft", id: number, pactproUrl: Fallback) => Promise<void>;

/**
 * "Open" for a document or draft (docs/DESKTOP_EDITING.md). Two choices: the desktop editor or the PactPro
 * editor. Which desktop program (Word, LibreOffice, ...) is Windows' own question when several can open
 * the file. If none starts, the PactPro editor opens.
 * `const { openDocument, dialog } = useOpenWith()`; render `dialog` once in the page.
 */
export function useOpenWith(): { openDocument: OpenDocument; dialog: ReactNode } {
  const navigate = useNavigate();
  const toast = useToast();
  const [pending, setPending] = useState<Pending | null>(null);
  const [remember, setRemember] = useState(false);
  const [busy, setBusy] = useState<Opener | null>(null);
  const toPactpro = useCallback((f: Fallback) => (typeof f === "string" ? navigate(f) : f()), [navigate]);

  // Try the desktop editor; when nothing starts, the PactPro editor opens instead.
  const tryDesktop = useCallback(async (links: DesktopLinks, pactproUrl: Fallback) => {
    const ok = await launch(desktopLink(links));
    markWorked(ok);
    if (ok) {
      toast.success(links.editable
        ? "Opening in your desktop editor. Save there as often as you like, then Save to PactPro (bottom right) makes it a version."
        : "Opening read-only in your desktop editor.");
    } else {
      toast.info("No desktop editor opened on this computer. Opening the PactPro editor.");
      toPactpro(pactproUrl);
    }
  }, [toPactpro, toast]);

  const openDocument = useCallback<OpenDocument>(async (kind, id, pactproUrl) => {
    if (isMobile()) { toPactpro(pactproUrl); return; }
    let links: DesktopLinks;
    try {
      links = await desktopLinks(kind, id);
    } catch (e) {
      toast.error(errorMessage(e, "Could not open this document."));
      return;
    }
    const prefs = openPrefs();
    if (prefs.remembered === "pactpro") { toPactpro(pactproUrl); return; }
    if (prefs.remembered === "desktop") { await tryDesktop(links, pactproUrl); return; }
    setRemember(false);
    setPending({ links, pactproUrl });
  }, [toPactpro, toast, tryDesktop]);

  const choose = async (o: Opener) => {
    if (!pending) return;
    if (remember) rememberOpener(o);
    if (o === "pactpro") { setPending(null); toPactpro(pending.pactproUrl); return; }
    setBusy(o);
    await tryDesktop(pending.links, pending.pactproUrl);
    setBusy(null);
    setPending(null);
  };

  const worked = openPrefs().worked;
  const links = pending?.links;
  const dialog = (
    <Modal open={!!pending} onClose={() => setPending(null)} size="narrow" title="Open with"
      sub={links ? `${links.name}${links.editable ? "" : " (read only)"}` : undefined}>
      {links && (
        <div className="stack">
          <Button icon="file" loading={busy === "desktop"} disabled={!!busy} onClick={() => void choose("desktop")}
            title="Word, LibreOffice or another program on this computer (you pick it next)">
            {`Desktop editor${worked === false ? " (didn't open last time)" : ""}`}
          </Button>
          <Button variant="primary" icon="edit" disabled={!!busy} onClick={() => void choose("pactpro")}>
            PactPro editor (in the browser)
          </Button>
          <Check label="Remember my choice on this computer" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
        </div>
      )}
    </Modal>
  );
  return { openDocument, dialog };
}
