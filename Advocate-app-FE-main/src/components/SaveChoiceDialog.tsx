import { useCallback, useRef, useState, type ReactNode } from "react";
import { Button } from "../ui/kit";
import { Check } from "../ui/forms";
import { Modal } from "../ui/overlays";
import { rememberSaveChoice, savedChoice, type SaveChoice } from "../utils/openWith";

/**
 * Where PactPro's Save goes (docs/DESKTOP_EDITING.md): PactPro and / or a copy on this computer. Asked every
 * time unless remembered on this computer. `ask()` resolves with the choice, or null when cancelled;
 * `ask(true)` always shows the dialog (to change a remembered choice).
 */
export function useSaveChoice(): { ask: (force?: boolean) => Promise<SaveChoice | null>; dialog: ReactNode } {
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState<SaveChoice>({ pactpro: true, copy: false });
  const [remember, setRemember] = useState(false);
  const resolver = useRef<((c: SaveChoice | null) => void) | null>(null);

  const ask = useCallback((force = false) => {
    const kept = savedChoice();
    if (kept && !force) return Promise.resolve(kept);
    setChoice(kept || { pactpro: true, copy: false });
    setRemember(!!kept);
    setOpen(true);
    return new Promise<SaveChoice | null>((resolve) => { resolver.current = resolve; });
  }, []);

  const finish = (c: SaveChoice | null) => {
    if (c) rememberSaveChoice(remember ? c : null);
    setOpen(false);
    resolver.current?.(c);
    resolver.current = null;
  };

  const dialog = (
    <Modal open={open} onClose={() => finish(null)} size="narrow" title="Save"
      footer={<>
        <Button variant="ghost" onClick={() => finish(null)}>Cancel</Button>
        <Button variant="primary" icon="check" disabled={!choice.pactpro && !choice.copy} onClick={() => finish(choice)}>Save</Button>
      </>}>
      <div className="stack">
        <Check label="Save to PactPro (a new version)" checked={choice.pactpro}
          onChange={(e) => setChoice((c) => ({ ...c, pactpro: e.target.checked }))} />
        <Check label="Save a copy to this computer" checked={choice.copy}
          onChange={(e) => setChoice((c) => ({ ...c, copy: e.target.checked }))} />
        <Check label="Remember my choice (don't ask again on this computer)" checked={remember}
          onChange={(e) => setRemember(e.target.checked)} />
        <p className="faint small">A remembered choice can be changed with Save options next to Save.</p>
      </div>
    </Modal>
  );
  return { ask, dialog };
}
