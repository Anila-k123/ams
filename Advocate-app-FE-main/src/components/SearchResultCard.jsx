import React from "react";

const SECTION_ICONS = {
  clients: "\uD83D\uDC64",
  cases: "\u2696\uFE0F",
  hearings: "\uD83D\uDCC5",
  documents: "\uD83D\uDCC4",
  expenses: "\uD83D\uDCB8",
  invoices: "\uD83D\uDCB0",
  payments: "\uD83D\uDCB3",
  tasks: "\u2714\uFE0F",
  events: "\uD83D\uDCC5",
};

function getDisplayTitle(section, item) {
  switch (section) {
    case "clients": return item.name;
    case "cases": return item.caseTitle || item.caseNumber;
    case "hearings":
    case "events": return item.title;
    case "documents": return item.documentName || item.originalName;
    case "invoices": return item.invoiceNumber;
    case "expenses": return item.title;
    case "payments": return `Payment #${item.id}`;
    case "tasks": return item.title;
    default: return "";
  }
}

function getDisplaySubtitle(section, item) {
  switch (section) {
    case "clients": return item.email || item.phone || "";
    case "cases": return `${item.caseNumber || ""} ${item.status ? `- ${item.status}` : ""}`;
    case "hearings":
    case "events": return item.eventType ? `${item.eventType} ${item.date ? `- ${item.date}` : ""}` : item.date || "";
    case "documents": return item.category || item.fileType || item.originalName || "";
    case "invoices": return `${item.status || ""} ${item.amount ? `- ₹${item.amount}` : ""}`;
    case "expenses": return item.category ? `${item.category} ${item.amount ? `- ₹${item.amount}` : ""}` : item.amount ? `₹${item.amount}` : "";
    case "payments": return `${item.paymentMode || ""} ${item.amount ? `- ₹${item.amount}` : ""}${item.clientName ? ` - ${item.clientName}` : ""}`;
    case "tasks": return item.completed ? "Completed" : item.priority || "";
    default: return "";
  }
}

export default function SearchResultCard({ section, item, isSelected, onClick, onMouseEnter }) {
  return (
    <div
      className={`search-result-item ${isSelected ? "selected" : ""}`}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
    >
      <div className="search-result-icon">{SECTION_ICONS[section] || "\uD83D\uDD0D"}</div>
      <div className="search-result-text">
        <div className="search-result-title">{getDisplayTitle(section, item)}</div>
        <div className="search-result-subtitle">{getDisplaySubtitle(section, item)}</div>
      </div>
    </div>
  );
}
