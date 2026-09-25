import { useState, useEffect, Fragment } from "react";
import { createPortal } from "react-dom";
import api from "../api/client";
import { topZIndex } from "../utils/topZIndex";
import "../assets/styles/CodeRefText.css";

/**
 * Renders text where old legal-code references (e.g. "Section 302 IPC", "u/s 65 Evidence
 * Act", "CrPC 154") are highlighted and clickable — a popover shows the post-July-2024
 * equivalent (BNS / BNSS / BSA) from /api/lawcodes/convert. Used in AI document summaries
 * so stale code references are explained in place without a web search.
 */

const ACT = "IPC|I\\.P\\.C\\.|Indian Penal Code|Cr\\.?P\\.?C\\.?|CrPC|Code of Criminal Procedure|Indian Evidence Act|Evidence Act|IEA|BNSS|BNS|BSA";
const SEC = "\\d{1,3}[A-Za-z]{0,2}(?:\\([0-9a-z]+\\))?";
// section-first ("Section 302 IPC" / "302 IPC")  OR  act-first ("IPC 302")
const REF_RE = new RegExp(
  `(?:(?:u/s|under\\s+)?\\s*(?:section|sec\\.?|s\\.)\\s*)?(${SEC})\\s*(?:of\\s+the\\s+)?(${ACT})\\b`
  + `|\\b(${ACT})\\s*(?:section|sec\\.?|s\\.)?\\s*(${SEC})`,
  "gi"
);

function canonAct(raw: string) {
  const s = (raw || "").toLowerCase().replace(/[.\s]/g, "");
  if (s.startsWith("bnss")) return "BNSS";
  if (s.startsWith("bns")) return "BNS";
  if (s.startsWith("bsa")) return "BSA";
  if (s.includes("penalcode") || s === "ipc" || s === "ipc") return "IPC";
  if (s.includes("criminalprocedure") || s.startsWith("crpc") || s.startsWith("crp")) return "CrPC";
  if (s.includes("evidence") || s === "iea") return "IEA";
  return raw;
}

function buildNodes(text: string, onClick: any, renderPlain: (t: string) => any) {
  const nodes: any[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  const plain = (seg: string, key: string) => nodes.push(<Fragment key={key}>{renderPlain(seg)}</Fragment>);
  REF_RE.lastIndex = 0;
  while ((m = REF_RE.exec(text)) !== null) {
    const [full] = m;
    const section = m[1] || m[4];
    const act = canonAct(m[2] || m[3]);
    if (m.index > last) plain(text.slice(last, m.index), `p${last}`);
    nodes.push(
      <span key={m.index} className="cr-ref" onClick={(e) => onClick(act, section, e)}>{full}</span>
    );
    last = m.index + full.length;
  }
  if (last < text.length) plain(text.slice(last), `p${last}`);
  return nodes;
}

export default function CodeRefText({ text, className, renderPlain = (t: string): any => t }: { text: string; className?: string; renderPlain?: (t: string) => any }) {
  const [pop, setPop] = useState<any>(null);

  const lookup = async (act: string, section: string, e: any) => {
    const r = e.currentTarget.getBoundingClientRect();
    const anchor = { left: r.left, top: r.bottom, bottom: r.top };
    setPop({ ...anchor, loading: true, act, section });
    try {
      const res = await api.get(
        `/api/lawcodes/convert?act=${encodeURIComponent(act)}&section=${encodeURIComponent(section)}`);
      setPop({ ...anchor, act, section, data: res.data });
    } catch {
      setPop({ ...anchor, act, section, data: { found: false } });
    }
  };

  return (
    <>
      <span className={className}>{buildNodes(text || "", lookup, renderPlain)}</span>
      {pop && <CodeRefPopover pop={pop} onClose={() => setPop(null)} />}
    </>
  );
}

function CodeRefPopover({ pop, onClose }: { pop: any; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Above whatever dialog it was opened from (see utils/topZIndex).
  const [z] = useState(() => topZIndex());
  const POP_W = 300, POP_H = 180, GAP = 6;
  const left = Math.max(12, Math.min(pop.left, window.innerWidth - POP_W - 12));
  const below = pop.top + GAP;
  const flipUp = below + POP_H > window.innerHeight && pop.bottom > POP_H;
  const top = flipUp ? Math.max(12, pop.bottom - GAP - POP_H) : below;

  const d = pop.data;
  return createPortal(
    <>
      <div className="cr-pop-backdrop" style={{ zIndex: z }} onClick={onClose} />
      <div className="cr-pop" style={{ left, top, zIndex: z + 1 }} onClick={(e) => e.stopPropagation()}>
        <button className="cr-pop-close" onClick={onClose}><i className="pi pi-times" style={{ fontSize: 12 }} /></button>
        {pop.loading && <div className="cr-pop-muted">Looking up {pop.act} §{pop.section}…</div>}
        {!pop.loading && (!d || !d.found) && (
          <div className="cr-pop-muted">No BNS/BNSS/BSA mapping found for {pop.act} §{pop.section}.</div>
        )}
        {!pop.loading && d && d.found && (
          <>
            <div className="cr-pop-map">
              <span className="cr-pop-old">{d.oldAct} §{d.oldSection}</span>
              <i className="pi pi-arrow-right" />
              <span className={`cr-pop-new ${d.repealed ? "repealed" : ""}`}>
                {d.repealed ? "Repealed" : `${d.newAct} §${d.newSection}`}
              </span>
            </div>
            {d.description && <div className="cr-pop-desc">{d.description}</div>}
            {d.changed && !d.repealed && <div className="cr-pop-note">Wording/penalty changed — verify the bare Act.</div>}
            {d.repealed && <div className="cr-pop-note">Repealed with no direct equivalent.</div>}
          </>
        )}
      </div>
    </>,
    document.body
  );
}
