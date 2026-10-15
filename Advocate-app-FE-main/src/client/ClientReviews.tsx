import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Button, EmptyState, Icon, Panel, Skel } from "../ui/kit";
import { clientDownload, clientGet, clientPostForm, fmtDate } from "./clientApi";

/* The client's side of client review (docs/CLIENT_REVIEW.md): documents the firm sent for their review. The
   client downloads their copy, edits it in their own Word / LibreOffice, uploads it back with a note, then sends
   their changes back or approves. (The in-portal editor is switched off for now: CLIENT_REVIEW_EDITOR.) */

type Msg = { id: number; author: "firm" | "client"; name: string; kind: string; text: string; round: number | null; at: string;
  files: { id: number; name: string; size: number }[] };

const KIND: Record<string, string> = { sent: "sent this for your review", changes: "sent changes back", approved: "approved",
  cancelled: "cancelled the review", message: "" };
const when = (iso?: string | null) => (iso ? new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "");

export function ReviewList() {
  const [items, setItems] = useState<any[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { clientGet("reviews").then((d) => setItems(d.items)).catch((e) => setError(e.message)); }, []);
  if (error) return <div className="callout bad" role="alert"><Icon name="warn" /><div>{error}</div></div>;
  if (!items) return <div className="stack"><Skel h={18} w="40%" /><Skel h={64} /></div>;
  return (
    <>
      <h1 className="serif pt-h">For your review</h1>
      <p className="muted pt-lead">Documents your advocate has sent you to check. Mark your changes, then send them back or approve.</p>
      {items.length === 0 ? <EmptyState icon="file" title="Nothing to review" text="When your advocate sends you a document to check, it appears here." /> : (
        <div className="list">
          {items.map((r) => (
            <Link key={r.id} to={`/client/reviews/${r.id}`} className="list-item pt-doc" style={{ textDecoration: "none", color: "inherit" }}>
              <Icon name="file" />
              <div className="grow">
                <b>{r.name}</b>
                <div className="faint small">
                  Sent {fmtDate(r.sentAt)}{r.round > 1 ? ` · version ${r.round}` : ""}{r.replyBy && r.waiting ? ` · please reply by ${fmtDate(r.replyBy)}` : ""}
                </div>
              </div>
              <span className={`chip ${r.waiting ? "warn" : r.status === "APPROVED" ? "ok" : ""}`}>
                {r.waiting ? "Waiting for you" : r.status === "APPROVED" ? "Approved" : "With your advocate"}
              </span>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}

export function ReviewPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [review, setReview] = useState<any>(null);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [fileKey, setFileKey] = useState(0);           // resets the file picker after sending
  const [busy, setBusy] = useState("");
  const [done, setDone] = useState("");

  const load = useCallback(() => {
    clientGet(`reviews/${id}`).then(setReview).catch((e) => setError(e.message));
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const send = async (action: "changes" | "approve" | "message") => {
    setBusy(action); setError("");
    try {
      const form = new FormData();
      form.append("action", action);
      form.append("note", note);
      files.forEach((f) => form.append("files", f));
      const r = await clientPostForm(`reviews/${id}/reply`, form);
      setReview(r); setNote(""); setFiles([]); setFileKey((k) => k + 1);
      setDone(action === "approve" ? "Thank you: your approval has been sent to your advocate."
        : action === "changes" ? "Your changes have been sent to your advocate." : "Your message has been sent.");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy("");
    }
  };

  if (error && !review) return <div className="callout bad" role="alert"><Icon name="warn" /><div>{error}</div></div>;
  if (!review) return <div className="stack"><Skel h={18} w="40%" /><Skel h={200} /></div>;
  const messages: Msg[] = review.messages || [];
  const fileName = review.rounds?.at(-1)?.fileName || "document";

  return (
    <>
      <button type="button" className="btn ghost sm" onClick={() => navigate("/client/reviews")}><Icon name="chevronLeft" size="sm" />All reviews</button>
      <h1 className="serif pt-h">{review.name}</h1>
      <p className="muted pt-lead">
        {review.waiting ? `Waiting for your review${review.replyBy ? `, please reply by ${fmtDate(review.replyBy)}` : ""}.`
          : review.status === "APPROVED" ? `You approved this on ${fmtDate(review.approved?.at)}.` : "Your advocate is working on your changes."}
      </p>
      {done && <div className="callout ok" role="status"><Icon name="check" /><div>{done}</div></div>}
      {error && <div className="callout bad" role="alert"><Icon name="warn" /><div>{error}</div></div>}

      {review.questions?.length > 0 && review.waiting && (
        <Panel title="Your advocate asks">
          <ol className="small" style={{ margin: 0, paddingLeft: 18 }}>{review.questions.map((q: string) => <li key={q}>{q}</li>)}</ol>
          <p className="faint small">Answer in your note below.</p>
        </Panel>
      )}

      {review.waiting ? (<>
        <Panel title="1. Download the document">
          <p className="small">Open it in your own Word, LibreOffice or another editor. Tip: switch on <b>Track Changes</b> so your advocate
            sees exactly what you changed.</p>
          <Button variant="primary" icon="download" onClick={() => void clientDownload(`reviews/${id}/file`, fileName)}>Download {fileName}</Button>
        </Panel>

        <Panel title="2. Make your changes and save the file" sub="Edit and save it on your computer. You can also add comments in the document." />

        <Panel title="3. Upload it and send it back" sub="Attach your edited file. You can add photos or a PDF too, and a note for your advocate.">
          <div className="stack">
            <input key={fileKey} type="file" multiple accept=".docx,.doc,.odt,.rtf,.pdf,.jpg,.jpeg,.png,.heic,.webp"
              onChange={(e) => setFiles(Array.from(e.target.files || []))} aria-label="Your edited document and any other files" />
            {files.length > 0 && <div className="faint small">{files.map((f) => f.name).join(", ")}</div>}
            <textarea className="input" rows={3} value={note} onChange={(e) => setNote(e.target.value)}
              placeholder="A note for your advocate, e.g. The rent should be 45,000. My wife's name is spelt Meena." aria-label="Your note" />
            <div className="row wrap" style={{ gap: 8 }}>
              <Button variant="primary" icon="send" loading={busy === "changes"} disabled={!!busy || (!files.length && !note.trim())}
                title={!files.length && !note.trim() ? "Upload your edited document or write what should change" : undefined}
                onClick={() => void send("changes")}>Send back with my changes</Button>
              <Button icon="check" loading={busy === "approve"} disabled={!!busy} onClick={() => void send("approve")}>
                No changes: approve this version
              </Button>
            </div>
          </div>
        </Panel>
      </>) : (
        <div className="row wrap" style={{ gap: 8, margin: "var(--s3) 0" }}>
          <Button icon="download" onClick={() => void clientDownload(`reviews/${id}/file`, fileName)}>Download {fileName}</Button>
        </div>
      )}

      {!review.waiting && review.status === "OPEN" && (
        <Panel title="Write to your advocate">
          <div className="stack">
            <textarea className="input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} aria-label="Message" />
            <input key={fileKey} type="file" multiple onChange={(e) => setFiles(Array.from(e.target.files || []))} aria-label="Attach files" />
            <div><Button icon="send" loading={busy === "message"} disabled={!!busy || (!note.trim() && !files.length)}
              onClick={() => void send("message")}>Send message</Button></div>
          </div>
        </Panel>
      )}

      <Panel title="Conversation">
        <div className="stack">
          {messages.map((m) => (
            <div key={m.id} style={{ borderLeft: `3px solid var(${m.author === "client" ? "--tape" : "--line-strong"})`, paddingLeft: 10 }}>
              <div className="small"><b>{m.author === "client" ? "You" : m.name || "Your advocate"}</b>{KIND[m.kind] ? ` ${KIND[m.kind]}` : ""}
                <span className="faint"> · {when(m.at)}</span></div>
              {m.text && <div className="small" style={{ whiteSpace: "pre-wrap" }}>{m.text}</div>}
              {m.files.map((f) => (
                <button key={f.id} type="button" className="btn ghost sm" onClick={() => void clientDownload(`reviews/files/${f.id}`, f.name)}>
                  <Icon name="file" size="sm" />{f.name}</button>
              ))}
            </div>
          ))}
        </div>
      </Panel>
    </>
  );
}
