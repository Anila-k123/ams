import { useEffect, useState } from "react";
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { InputText } from "primereact/inputtext";
import { Tag } from "primereact/tag";
import api from "../api/client";
import { useAuth } from "../context/AuthContext";
import "../assets/styles/Communication.css";

const STATUS_ICONS: Record<string, any> = {
  SENT: <i className="pi pi-check-circle" style={{ color: "var(--success)" }} />,
  FAILED: <i className="pi pi-times-circle" style={{ color: "var(--danger)" }} />,
  PENDING: <i className="pi pi-clock" style={{ color: "var(--warning)" }} />,
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

  return (
    <div className="comm-page">
      <span className="p-input-icon-left w-full mb-3">
        <i className="pi pi-search" />
        <InputText
          className="w-full"
          placeholder="Search by recipient, subject, or channel..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </span>

      <DataTable value={filtered} loading={loading} dataKey="id" emptyMessage="No history found" stripedRows size="small">
        <Column header="Status" body={(h) => STATUS_ICONS[h.status] || <i className="pi pi-clock" />} />
        <Column header="Channel" body={(h) => <Tag value={h.channel} severity="info" />} />
        <Column header="Type" body={(h) => <Tag value={h.type} severity="secondary" />} />
        <Column field="recipient" header="Recipient" />
        <Column header="Subject" body={(h) => h.subject || "-"} />
        <Column header="Sent At" body={(h) => (h.sentAt ? new Date(h.sentAt).toLocaleString() : "-")} />
      </DataTable>
    </div>
  );
}
