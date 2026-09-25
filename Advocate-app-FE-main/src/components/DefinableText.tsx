import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import api from "../api/client";
import "../assets/styles/DefinableText.css";

/**
 * Renders text where any word can be clicked to look up its legal-dictionary
 * definition in a small popover. Used in the document AI summary so jargon is
 * explainable in place.
 */
export default function DefinableText({ text, className }: { text: string; className?: string }) {
  const [pop, setPop] = useState<any>(null); // { x, y, loading?, word, term?, definition?, notFound? }

  const lookup = async (raw: string, e: any) => {
    const q = (raw || "").replace(/[^A-Za-z][^A-Za-z-]*$/,"").replace(/[^A-Za-z-]/g, "").trim();
    if (q.length < 2) return;
    // Anchor the popover directly below the clicked word (not the cursor).
    const r = e.currentTarget.getBoundingClientRect();
    const anchor = { left: r.left, top: r.bottom, bottom: r.top };
    setPop({ ...anchor, loading: true, word: q });
    try {
      const s = await api.get(`/api/dictionary/search?q=${encodeURIComponent(q)}&limit=1`);
      if (!s.data || s.data.length === 0) { setPop({ ...anchor, word: q, notFound: true }); return; }
      const d = await api.get(`/api/dictionary/term/${s.data[0].id}`);
      setPop({ ...anchor, term: d.data.term, definition: d.data.definition });
    } catch {
      setPop({ ...anchor, word: q, notFound: true });
    }
  };

  const tokens = (text || "").split(/(\s+)/);
  return (
    <>
      <span className={className}>
        {tokens.map((tok, i) =>
          /\S/.test(tok)
            ? <span key={i} className="def-word" onClick={(e) => lookup(tok, e)}>{tok}</span>
            : tok
        )}
      </span>
      {pop && <DefinePopover pop={pop} onClose={() => setPop(null)} />}
    </>
  );
}

function DefinePopover({ pop, onClose }: { pop: any; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Sit directly below the clicked word, clamped to the viewport. If there is not
  // enough room below, flip it above the word instead.
  const POP_W = 320, POP_H = 220, GAP = 6;
  const left = Math.max(12, Math.min(pop.left, window.innerWidth - POP_W - 12));
  const below = pop.top + GAP;
  const flipUp = below + POP_H > window.innerHeight && pop.bottom > POP_H;
  const top = flipUp ? Math.max(12, pop.bottom - GAP - POP_H) : below;

  // Portal to <body> so the fixed-positioned popover escapes the modal's
  // backdrop-filter containing block and anchors to the real viewport.
  return createPortal(
    <>
      <div className="def-pop-backdrop" onClick={onClose} />
      <div className="def-pop" style={{ left, top }} onClick={(e) => e.stopPropagation()}>
        <button className="def-pop-close" onClick={onClose}><i className="pi pi-times" style={{ fontSize: 12 }} /></button>
        {pop.loading && <div className="def-pop-muted">Looking up “{pop.word}”…</div>}
        {pop.notFound && <div className="def-pop-muted">No dictionary entry for “{pop.word}”.</div>}
        {pop.term && (
          <>
            <div className="def-pop-term">{pop.term}</div>
            <div className="def-pop-def">
              {(pop.definition || "").split(/\n{2,}/).filter(Boolean).map((l, i) => <p key={i}>{l}</p>)}
            </div>
          </>
        )}
      </div>
    </>,
    document.body
  );
}
