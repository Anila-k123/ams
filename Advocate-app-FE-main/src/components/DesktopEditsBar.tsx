import { useCallback, useEffect, useState } from "react";
import api, { errorMessage, getToken } from "../api/client";
import { useToast } from "../contexts/ToastContext";
import { Button } from "../ui/kit";
import { confirm } from "../ui/overlays";
import { useSaveChoice } from "./SaveChoiceDialog";
import { saveBlob } from "../utils/openWith";
import "../ui/pages/desktop.css";

type Work = { kind: "doc" | "draft"; id: number; name: string; updated: string; open: boolean; inEditor: boolean };

/** Pages that show a document / draft listen for this to reload after its desktop edits were saved. */
export const DESKTOP_SAVED_EVENT = "pactpro:desktop-saved";

/**
 * Desktop edits not yet saved to PactPro (docs/DESKTOP_EDITING.md). Saving in Word / LibreOffice only
 * updates a working copy, so users can save there as often as they like; this bar, on every page, turns
 * the working copy into one PactPro version (Save to PactPro, with the usual save choice) or drops it.
 * Checked when the page gets focus back (the user returning from the desktop program) and every 20 s.
 */
export default function DesktopEditsBar() {
  const toast = useToast();
  const saveChoice = useSaveChoice();
  const [items, setItems] = useState<Work[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!getToken() || document.hidden) return;
    // One open in the PactPro editor is saved with that page's Save (it may hold newer edits).
    api.get<{ items: Work[] }>("/api/desktop-work").then((r) => setItems(r.data.items.filter((w) => !w.inEditor)))
      .catch(() => { /* logged out, or a client account: nothing to show */ });
  }, []);
  useEffect(() => {
    load();
    const timer = setInterval(load, 20000);
    window.addEventListener("focus", load);
    document.addEventListener("visibilitychange", load);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", load);
      document.removeEventListener("visibilitychange", load);
    };
  }, [load]);

  const key = (w: Work) => `${w.kind}-${w.id}`;
  const save = async (w: Work) => {
    const choice = await saveChoice.ask();
    if (!choice) return;
    setBusy(key(w));
    try {
      if (choice.copy) {
        const r = await api.get<Blob>(`/api/desktop-work/${w.kind}/${w.id}`, { responseType: "blob" });
        saveBlob(r.data, w.name);
      }
      if (choice.pactpro) {
        await api.post(`/api/desktop-work/${w.kind}/${w.id}`, { action: "save" });
        window.dispatchEvent(new CustomEvent(DESKTOP_SAVED_EVENT, { detail: { kind: w.kind, id: w.id } }));
        toast.success(`${w.name} saved to PactPro as a new version.`);
      } else {
        toast.success("Copy saved to this computer. The edits are still waiting to be saved to PactPro.");
      }
      load();
    } catch (e) {
      toast.error(errorMessage(e, "Could not save the edits."));
    } finally {
      setBusy(null);
    }
  };
  const discard = (w: Work) => confirm({
    title: "Discard these edits?",
    message: `What was saved in the editor for ${w.name} is dropped; the PactPro version stays as it is.`,
    confirmLabel: "Discard", danger: true,
    accept: async () => {
      try {
        await api.post(`/api/desktop-work/${w.kind}/${w.id}`, { action: "discard" });
        load();
      } catch (e) {
        toast.error(errorMessage(e, "Could not discard the edits."));
      }
    },
  });

  if (items.length === 0) return <>{saveChoice.dialog}</>;
  return (
    <>
      <div className="desktop-edits" role="region" aria-label="Edits not saved to PactPro">
        <strong className="small">Edits not saved to PactPro</strong>
        {items.map((w) => (
          <div key={key(w)} className="desktop-edits-row">
            <div className="desktop-edits-name">
              <span className="small" title={w.name}>{w.name}</span>
              <span className="faint xs">{w.open ? "Still open in the desktop editor" : `Saved in an editor ${new Date(w.updated).toLocaleString()}, not in PactPro yet`}</span>
            </div>
            <Button size="sm" variant="primary" icon="check" loading={busy === key(w)} disabled={!!busy}
              title="Make what you saved in the editor a new PactPro version" onClick={() => void save(w)}>
              Save to PactPro
            </Button>
            <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => discard(w)}>Discard</Button>
          </div>
        ))}
      </div>
      {saveChoice.dialog}
    </>
  );
}
