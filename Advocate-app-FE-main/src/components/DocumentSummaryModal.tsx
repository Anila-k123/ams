import { useEffect, useState, useCallback, useRef } from "react";
import { Modal } from "../ui/overlays";
import { Button, Chip, Icon, Spinner } from "../ui/kit";
import { jsPDF } from "jspdf";
import DefinableText from "./DefinableText";
import CodeRefText from "./CodeRefText";
import documentService from "../services/DocumentService";

// Summary text with BOTH layers: old-code references (IPC→BNS…) become clickable
// convert popovers, and remaining words stay dictionary-lookup clickable.
const RichText = ({ text }: { text: any }) => (
  <CodeRefText text={String(text)} renderPlain={(t: string) => <DefinableText text={t} />} />
);
import "../ui/pages/clients.css";

// The labelled key-point sections, in display order. Each field is best-effort;
// empty ones are skipped. `kind` decides how the value is rendered.
const SECTIONS: any[] = [
  { key: "document_type", label: "Document type", kind: "text" },
  { key: "parties", label: "Parties involved", kind: "pairs", a: "name", b: "role" },
  { key: "court_and_case_ref", label: "Court & case reference", kind: "text" },
  { key: "key_dates", label: "Key dates", kind: "pairs", a: "date", b: "description" },
  { key: "reliefs_sought", label: "Reliefs / prayers sought", kind: "list" },
  { key: "key_facts", label: "Key facts & allegations", kind: "list" },
  { key: "legal_grounds", label: "Legal grounds / statutes cited", kind: "list" },
  { key: "obligations", label: "Obligations / undertakings", kind: "pairs", a: "party", b: "obligation" },
  { key: "monetary_amounts", label: "Monetary amounts", kind: "pairs", a: "amount", b: "context" },
  { key: "action_items", label: "Action items / next steps", kind: "list" },
  { key: "risks", label: "Risks / red flags", kind: "list" },
];

function isEmpty(v: any) {
  if (v === null || v === undefined) return true;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === "string") return v.trim() === "";
  return false;
}

function Section({ section, value }: { section: any; value: any }) {
  if (isEmpty(value)) return null;
  return (
    <section>
      <h4 className="ds-section-label">{section.label}</h4>
      {section.kind === "text" && <p className="ds-text"><RichText text={String(value)} /></p>}
      {section.kind === "list" && (
        <ul className="ds-list">
          {(Array.isArray(value) ? value : [value]).map((item: any, i: number) => (
            <li key={i}>{typeof item === "string" ? <RichText text={item} /> : JSON.stringify(item)}</li>
          ))}
        </ul>
      )}
      {section.kind === "pairs" && (
        <ul className="ds-list">
          {(Array.isArray(value) ? value : [value]).map((item: any, i: number) => {
            if (item && typeof item === "object") {
              const a = item[section.a];
              const b = item[section.b];
              return (
                <li key={i}>
                  {a && <strong>{a}</strong>}
                  {a && b ? " — " : ""}
                  {b}
                </li>
              );
            }
            return <li key={i}>{String(item)}</li>;
          })}
        </ul>
      )}
    </section>
  );
}

export default function DocumentSummaryModal({ doc, onClose, canRegenerate = false }: { doc: any; onClose: () => void; canRegenerate?: boolean }) {
  const [data, setData] = useState<any>(null); // { status, summary, keyPoints, error, updatedAt }
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(false);
  const pollRef = useRef<any>(null);

  const load = useCallback(async () => {
    if (!doc) return;
    setLoading(true);
    setLoadError("");
    try {
      const res = await documentService.getSummary(doc.id);
      setData(res);
    } catch (err) {
      console.error("Summary load error:", err);
      setLoadError("Could not load the summary. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [doc]);

  useEffect(() => {
    load();
    return () => {
      if (pollRef.current) clearTimeout(pollRef.current);
    };
  }, [load]);

  // Auto-poll while the summary is still being generated.
  useEffect(() => {
    if (data && (data.status === "PENDING" || data.status === "PROCESSING")) {
      pollRef.current = setTimeout(load, 3000);
    }
    return () => {
      if (pollRef.current) clearTimeout(pollRef.current);
    };
  }, [data, load]);

  const regenerate = async () => {
    setBusy(true);
    try {
      await documentService.regenerateSummary(doc.id);
      await load();
    } catch (err) {
      console.error("Regenerate error:", err);
      setLoadError("Could not start summarization. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const status = data?.status;
  const keyPoints = data?.keyPoints || {};
  const summaryText = data?.summary || keyPoints.summary;

  const downloadPdf = () => {
    const pdf = new jsPDF({ unit: "pt", format: "a4" });
    const margin = 48;
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const maxW = pageW - margin * 2;
    let y = margin;

    const ensure = (h: number) => {
      if (y + h > pageH - margin) { pdf.addPage(); y = margin; }
    };
    const write = (text: any, { size = 11, bold = false, gap = 4, color = [30, 30, 30] as [number, number, number] }: { size?: number; bold?: boolean; gap?: number; color?: [number, number, number] } = {}) => {
      pdf.setFont("helvetica", bold ? "bold" : "normal");
      pdf.setFontSize(size);
      pdf.setTextColor(...color);
      const lines = pdf.splitTextToSize(String(text), maxW);
      for (const line of lines) {
        ensure(size + 2);
        pdf.text(line, margin, y);
        y += size + 2;
      }
      y += gap;
    };

    write(`Summary — ${doc?.documentName || "Document"}`, { size: 16, bold: true, gap: 6 });
    if (keyPoints.document_type) write(keyPoints.document_type, { size: 10, bold: true, color: [139, 92, 246], gap: 8 });
    if (summaryText) write(summaryText, { size: 11, gap: 10 });

    for (const s of SECTIONS) {
      if (s.key === "document_type") continue;
      const val = keyPoints[s.key];
      if (isEmpty(val)) continue;
      write(s.label.toUpperCase(), { size: 9, bold: true, color: [120, 120, 120], gap: 3 });
      if (s.kind === "text") {
        write(String(val), { size: 11, gap: 8 });
      } else {
        const arr = Array.isArray(val) ? val : [val];
        for (const item of arr) {
          let line: string;
          if (s.kind === "pairs" && item && typeof item === "object") {
            const a = item[s.a], b = item[s.b];
            line = a && b ? `${a} — ${b}` : (a || b || "");
          } else {
            line = typeof item === "string" ? item : JSON.stringify(item);
          }
          write(`•  ${line}`, { size: 11, gap: 2 });
        }
        y += 6;
      }
    }

    const safe = (doc?.documentName || "document").replace(/\.[^.]+$/, "").replace(/[^\w.-]+/g, "_");
    pdf.save(`${safe}_summary.pdf`);
  };

  const notReady = !loading && !loadError;
  return (
    <Modal open={!!doc} onClose={onClose} size="wide" title="Document summary" sub={doc?.documentName || "Document"}
      footer={notReady && status === "READY" ? (
        <>
          {canRegenerate && (
            <Button variant="ghost" icon="refresh" onClick={regenerate} disabled={busy} loading={busy}>
              {busy ? "Regenerating…" : "Regenerate"}
            </Button>
          )}
          <Button variant="primary" icon="download" onClick={downloadPdf}>Download PDF</Button>
        </>
      ) : undefined}>
      {loading && <div className="ds-state"><Spinner label="Loading summary" /></div>}

      {!loading && loadError && (
        <div className="ds-state bad">
          <span><Icon name="warn" size="sm" />{loadError}</span>
          <Button size="sm" icon="refresh" onClick={load}>Retry</Button>
        </div>
      )}

      {notReady && (status === "PENDING" || status === "PROCESSING") && (
        <div className="ds-state">
          <span><Icon name="clock" size="sm" />The summary is being generated. This usually takes a few seconds…</span>
          <Button size="sm" icon="refresh" onClick={load} disabled={busy}>Refresh</Button>
        </div>
      )}

      {notReady && status === "UNSUPPORTED" && (
        <div className="callout warn">
          <Icon name="warn" size="sm" />
          <span>A summary isn&apos;t available for this file type. Only text-based PDFs, Word documents and text
          files can be summarised (scanned images aren&apos;t supported).</span>
        </div>
      )}

      {notReady && (status === "NONE" || status === "FAILED") && (
        <div className="ds-state">
          {status === "FAILED" ? (
            <span><Icon name="warn" size="sm" />Summarisation failed{data?.error ? `: ${data.error}` : "."}</span>
          ) : (
            <span><Icon name="sparkle" size="sm" />No summary has been generated for this document yet.</span>
          )}
          {canRegenerate && (
            <Button size="sm" variant="primary" icon="sparkle" onClick={regenerate} disabled={busy} loading={busy}>
              {busy ? "Starting…" : status === "FAILED" ? "Retry" : "Generate summary"}
            </Button>
          )}
        </div>
      )}

      {notReady && status === "READY" && (
        <div className="stack">
          {keyPoints.document_type && <div><Chip tone="info">{keyPoints.document_type}</Chip></div>}
          {summaryText && <p className="ds-summary"><RichText text={summaryText} /></p>}
          <p className="faint xs">Click a word for its legal meaning, or an old code reference (IPC, CrPC, Evidence Act) for its new equivalent.</p>
          <div className="ds-sections">
            {SECTIONS.filter((s) => s.key !== "document_type").map((s) => (
              <Section key={s.key} section={s} value={keyPoints[s.key]} />
            ))}
          </div>
        </div>
      )}
    </Modal>
  );
}
