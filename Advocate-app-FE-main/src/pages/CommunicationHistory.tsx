import { useEffect, useState } from "react";
import api from "../api/client";
import { useAuth } from "../context/AuthContext";
import { PageHead, Chip, StatusChip, titleCase } from "../ui/kit";
import { SearchInput } from "../ui/forms";
import { DataTable, type Column } from "../ui/DataTable";
import "../ui/pages/research.css";

const fmt = (iso: string) => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
};

export default function CommunicationHistory() {
  const { token } = useAuth();
  const [history, setHistory] = useState<any[]>([]);
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) return;
    api
      .get(`/api/communication/history`)
      .then((res) => setHistory(res.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [token]);

  const f = filter.toLowerCase();
  const filtered = history.filter(
    (h) =>
      h.recipient?.toLowerCase().includes(f) ||
      h.subject?.toLowerCase().includes(f) ||
      h.channel?.toLowerCase().includes(f)
  );

  const columns: Column<any>[] = [
    { key: "status", label: "Status", sort: true, render: (h) => <StatusChip status={h.status || "PENDING"} /> },
    { key: "channel", label: "Channel", sort: true, render: (h) => <Chip tone="info">{titleCase(h.channel)}</Chip> },
    { key: "type", label: "Type", hideSm: true, sort: true, render: (h) => <span className="small nowrap">{titleCase(h.type) || "—"}</span> },
    { key: "recipient", label: "Recipient", sort: true, render: (h) => <span className="cell-title">{h.recipient || "—"}</span> },
    { key: "subject", label: "Subject", hideSm: true, render: (h) => <span className="small">{h.subject || "—"}</span> },
    { key: "sentAt", label: "Sent", sort: (h) => (h.sentAt ? new Date(h.sentAt).getTime() : null), render: (h) => <span className="small nowrap">{fmt(h.sentAt)}</span> },
  ];

  return (
    <div>
      <PageHead title="Message History" sub="Every message sent from the Client Messages channels, newest first." />
      <div className="toolbar">
        <SearchInput value={filter} onChange={setFilter} placeholder="Search recipient, subject or channel" />
      </div>
      <DataTable rows={filtered} columns={columns} rowKey={(h) => h.id} loading={loading} caption="Message history"
        initialSort={{ key: "sentAt", dir: "desc" }}
        empty={{ icon: "history", title: filter ? "No messages match" : "No messages yet", text: filter ? "Try a different name or subject." : "Messages appear here once PactPro sends one." }} />
    </div>
  );
}
