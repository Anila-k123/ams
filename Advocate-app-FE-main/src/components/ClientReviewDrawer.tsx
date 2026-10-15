import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import api, { errorMessage } from "../api/client";
import { useToast } from "../contexts/ToastContext";
import { Button, Chip, Icon } from "../ui/kit";
import { Field, TextArea, TextField } from "../ui/forms";
import { Drawer, confirm } from "../ui/overlays";
import { saveBlob } from "../utils/openWith";
import { documentEditorUrl } from "../utils/taskDocument";

/* Firm side of client review (docs/CLIENT_REVIEW.md): send a document to its client for review, follow the
   thread, open the client's changes in the editor, send the next round, see the approval. */

type RFile = { id: number; name: string; size: number };
type RMessage = { id: number; author: "firm" | "client"; name: string; kind: string; text: string; round: number | null; at: string; files: RFile[] };
type RRound = { id: number; number: number; version: number; status: string; fileName: string; editable: boolean; sentAt: string;
  clientSavedAt: string | null; returnedAt: string | null; approvedAt: string | null };
export type Review = { id: number; status: string; message: string; questions: string[]; replyBy: string | null;
  approved: { version: number; at: string; by: string } | null; rounds: RRound[]; current: number | null;
  waitingOn: "client" | "firm" | null; messages: RMessage[] };
type Data = { reviews: Review[]; client: { id: number; name: string; hasLogin: boolean } | null; canSend: boolean };

const when = (iso?: string | null) => (iso ? new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "");

/** A short status for lists: what the latest review with the client is waiting on. */
export function clientReviewLabel(r?: { status: string; waitingOn: string | null } | null) {
  if (!r) return null;
  if (r.status === "APPROVED") return { tone: "ok" as const, text: "Client approved" };
  if (r.waitingOn === "client") return { tone: "warn" as const, text: "With client" };
  if (r.waitingOn === "firm") return { tone: "info" as const, text: "Client replied" };
  return null;
}

const KIND: Record<string, string> = {
  sent: "sent the document for review", changes: "sent changes back", approved: "approved this version",
  cancelled: "cancelled the review", message: "",
};

export default function ClientReviewDrawer({ doc, onClose, onChanged }: { doc: any | null; onClose: () => void; onChanged?: () => void }) {
  const toast = useToast();
  const navigate = useNavigate();
  const [data, setData] = useState<Data | null>(null);
  const [busy, setBusy] = useState(false);
  // New review
  const [message, setMessage] = useState("");
  const [questions, setQuestions] = useState("");
  const [replyBy, setReplyBy] = useState("");
  // Reply / next round
  const [reply, setReply] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [roundNote, setRoundNote] = useState("");

  const load = useCallback(() => {
    if (!doc) return;
    api.get<Data>(`/api/documents/${doc.id}/client-reviews`).then((r) => setData(r.data))
      .catch((e) => toast.error(errorMessage(e, "Could not load the client review.")));
  }, [doc, toast]);
  useEffect(() => { setData(null); setMessage(""); setQuestions(""); setReplyBy(""); setReply(""); setFiles([]); setRoundNote(""); load(); }, [load]);

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      toast.success(ok);
      load();
      onChanged?.();
    } catch (e) {
      toast.error(errorMessage(e, "That didn't work."));
    } finally {
      setBusy(false);
    }
  };

  const open = data?.reviews.find((r) => r.status === "OPEN") || null;
  const latest = open || data?.reviews[0] || null;
  const today = new Date().toISOString().slice(0, 10);

  const send = () => run(() => api.post(`/api/documents/${doc.id}/client-reviews`, {
    message, questions: questions.split("\n").map((q) => q.trim()).filter(Boolean), replyBy: replyBy || null,
  }), `Sent to ${data?.client?.name || "the client"} for review.`);

  const sendReply = (r: Review) => run(async () => {
    const fd = new FormData();
    fd.append("text", reply);
    files.forEach((f) => fd.append("files", f));
    await api.post(`/api/client-reviews/${r.id}/messages`, fd);
    setReply(""); setFiles([]);
  }, "Sent to the client.");

  const nextRound = (r: Review) => run(async () => {
    await api.post(`/api/client-reviews/${r.id}/rounds`, { message: roundNote });
    setRoundNote("");
  }, "Revised version sent to the client.");

  const cancel = (r: Review) => confirm({
    title: "Cancel this review?", message: "The client will no longer see it. The thread stays on record here.",
    confirmLabel: "Cancel review", danger: true,
    accept: () => run(() => api.post(`/api/client-reviews/${r.id}/cancel`), "Review cancelled."),
  });

  const download = async (url: string, name: string) => {
    try {
      const r = await api.get<Blob>(url, { responseType: "blob" });
      saveBlob(r.data, name);
    } catch (e) {
      toast.error(errorMessage(e, "Could not download the file."));
    }
  };

  const compare = (query: string) => { onClose(); navigate(`${documentEditorUrl(doc.id)}?${query}`); };

  return (
    <Drawer open={!!doc} onClose={onClose} wide title="Client review" sub={doc ? doc.documentName : undefined}>
      {!data ? <p className="faint small">Loading…</p> : (
        <div className="stack" style={{ gap: "var(--s4)" }}>
          {/* Who may send: those who may edit documents (the same rule as Share with client). */}
          {!data.canSend && !latest && (
            <p className="small" style={{ color: "var(--warn)" }}>
              Only colleagues allowed to edit documents, or the person working on this document's open task, can send it
              to the client for review. Ask your senior (or an admin) to send it.
            </p>
          )}
          {/* Start a review */}
          {!open && data.canSend && (
            <section className="stack" style={{ gap: "var(--s2)" }}>
              <strong>Send to {data.client?.name || "the client"} for review</strong>
              {!data.client ? (
                <p className="small" style={{ color: "var(--warn)" }}>Link this document to a client or a case first.</p>
              ) : !data.client.hasLogin ? (
                <p className="small" style={{ color: "var(--warn)" }}>{data.client.name} has no portal login yet: create one on the client's page.</p>
              ) : (<>
                <TextArea label="Message" rows={3} value={message} onChange={(e) => setMessage(e.target.value)}
                  placeholder="e.g. Please check the names, rent and deposit, and tell us of any changes." />
                <TextArea label="Questions for the client" hint="Optional, one per line" rows={2} value={questions}
                  onChange={(e) => setQuestions(e.target.value)} placeholder="Confirm the deposit amount" />
                <TextField label="Reply by" hint="Optional: the client gets a reminder after this date" type="date" min={today}
                  value={replyBy} onChange={(e) => setReplyBy(e.target.value)} />
                <p className="faint small">The client gets their own copy of the current version (your comments removed) to download,
                  edit in their own Word and upload back. Your document isn't changed by them.</p>
                <div><Button variant="primary" icon="send" loading={busy} disabled={busy} onClick={() => void send()}>Send for review</Button></div>
              </>)}
            </section>
          )}

          {latest && (
            <section className="stack" style={{ gap: "var(--s3)" }}>
              <div className="row wrap" style={{ gap: 8, alignItems: "center" }}>
                <strong>{latest.status === "OPEN" ? "Current review" : "Last review"}</strong>
                {latest.status === "APPROVED" && <Chip tone="ok">{`Approved v${latest.approved?.version} · ${latest.approved?.by} · ${when(latest.approved?.at)}`}</Chip>}
                {latest.status === "CANCELLED" && <Chip>Cancelled</Chip>}
                {latest.waitingOn === "client" && <Chip tone="warn">Waiting on the client</Chip>}
                {latest.waitingOn === "firm" && <Chip tone="info">Client replied: your turn</Chip>}
                {latest.replyBy && latest.status === "OPEN" && <span className="faint small">Reply by {new Date(latest.replyBy).toLocaleDateString("en-IN")}</span>}
              </div>
              {latest.questions.length > 0 && (
                <div className="small"><span className="faint">Questions asked:</span> {latest.questions.join(" · ")}</div>
              )}

              {/* Rounds: each version sent and the client's copy */}
              <div className="stack" style={{ gap: 4 }}>
                {latest.rounds.map((r) => (
                  <div key={r.id} className="row wrap" style={{ gap: 8, alignItems: "center" }}>
                    <span className="small" style={{ flex: 1 }}>
                      <strong>Round {r.number}</strong> · v{r.version} sent {when(r.sentAt)} · {
                        r.status === "SENT" ? (r.clientSavedAt ? `client editing (saved ${when(r.clientSavedAt)})` : "not opened yet")
                          : r.status === "RETURNED" ? `changes sent back ${when(r.returnedAt)}`
                            : r.status === "APPROVED" ? `approved ${when(r.approvedAt)}` : "replaced by a later round"}
                    </span>
                    {r.editable && r.clientSavedAt && (r.status === "RETURNED" || r.status === "SENT" || r.status === "APPROVED") && (
                      <Button size="sm" icon="swap" title="Open your document compared with the client's copy: their edits show as tracked changes to accept or reject"
                        onClick={() => compare(`compareRound=${r.id}`)}>Open client's changes</Button>
                    )}
                    <Button size="sm" variant="ghost" iconOnly icon="download" aria-label={`Download the client's copy (round ${r.number})`}
                      title="Download the client's copy" onClick={() => void download(`/api/client-reviews/${latest.id}/rounds/${r.number}/file`, r.fileName)} />
                  </div>
                ))}
              </div>

              {/* Thread */}
              <div className="stack" style={{ gap: "var(--s2)" }}>
                {latest.messages.map((m) => (
                  <div key={m.id} className="panel" style={{ padding: "var(--s2) var(--s3)", borderLeft: `3px solid var(${m.author === "client" ? "--tape" : "--line-strong"})` }}>
                    <div className="small">
                      <strong>{m.name || (m.author === "client" ? "Client" : "Firm")}</strong>
                      {KIND[m.kind] ? ` ${KIND[m.kind]}` : ""}{m.round ? ` (round ${m.round})` : ""}
                      <span className="faint"> · {when(m.at)}</span>
                    </div>
                    {m.text && <div className="small" style={{ whiteSpace: "pre-wrap", marginTop: 4 }}>{m.text}</div>}
                    {m.files.map((f) => (
                      <div key={f.id} className="row" style={{ gap: 6, marginTop: 4, alignItems: "center" }}>
                        <Icon name="file" size="sm" />
                        <button type="button" className="btn ghost sm" onClick={() => void download(`/api/client-review-files/${f.id}`, f.name)}>{f.name}</button>
                        {/\.docx$/i.test(f.name) && (
                          <Button size="sm" variant="ghost" icon="swap" title="Compare your document with this file in the editor"
                            onClick={() => compare(`compareFile=${f.id}`)}>Compare in editor</Button>
                        )}
                      </div>
                    ))}
                  </div>
                ))}
              </div>

              {latest.status === "OPEN" && data.canSend && (<>
                <Field label="Write to the client">
                  {(id) => <textarea id={id} className="input" rows={2} value={reply} onChange={(e) => setReply(e.target.value)} />}
                </Field>
                <div className="row wrap" style={{ gap: 8, alignItems: "center" }}>
                  <input type="file" multiple onChange={(e) => setFiles(Array.from(e.target.files || []))} />
                  <Button size="sm" icon="send" loading={busy} disabled={busy || (!reply.trim() && !files.length)}
                    onClick={() => void sendReply(latest)}>Send message</Button>
                </div>
                <div className="stack" style={{ gap: 6, borderTop: "1px solid var(--line)", paddingTop: "var(--s3)" }}>
                  <strong className="small">Send the revised version</strong>
                  <TextField label="What changed" hint="Optional" value={roundNote} onChange={(e) => setRoundNote(e.target.value)}
                    placeholder="e.g. Rent updated; the pets clause is now 9.3" />
                  <div className="row wrap" style={{ gap: 8 }}>
                    <Button size="sm" variant="primary" icon="send" loading={busy} disabled={busy} onClick={() => void nextRound(latest)}>
                      Send version {doc?.version ?? ""} for review
                    </Button>
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => cancel(latest)}>Cancel review</Button>
                  </div>
                </div>
              </>)}
            </section>
          )}

          {data.reviews.length > 1 && (
            <p className="faint small">{data.reviews.length - 1} earlier review{data.reviews.length > 2 ? "s" : ""} of this document are kept on record.</p>
          )}
        </div>
      )}
    </Drawer>
  );
}
