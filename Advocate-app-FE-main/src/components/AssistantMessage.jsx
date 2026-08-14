import React from "react";
import { formatCurrency } from "../utils/formatCurrency";

function AssistantResults({ results }) {
  if (!results || results.length === 0) return null;
  return (
    <div className="assistant-results">
      {results.map((item, i) => (
        <div key={item.id || i} className="assistant-result-item">
          {item.caseNumber && <span className="ar-case">{item.caseNumber}</span>}
          {item.title && <span className="ar-title">{item.title}</span>}
          {item.name && <span className="ar-name">{item.name}</span>}
          {item.invoiceNumber && <span className="ar-inv">{item.invoiceNumber}</span>}
          {item.fileName && <span className="ar-file">{item.fileName}</span>}
          {item.clientName && <span className="ar-client">{item.clientName}</span>}
          {item.amount != null && <span className="ar-amount">{formatCurrency(item.amount)}</span>}
          {item.status && <span className={`ar-status ${item.status.toLowerCase()}`}>{item.status}</span>}
          {item.date && <span className="ar-date">{item.date}</span>}
          {item.time && <span className="ar-time">{item.time}</span>}
          {item.phone && <span className="ar-phone">{item.phone}</span>}
          {item.email && <span className="ar-email">{item.email}</span>}
          {item.category && <span className="ar-cat">{item.category}</span>}
        </div>
      ))}
    </div>
  );
}

export default function AssistantMessage({ message }) {
  const isUser = message.sender === "user";
  const text = message.text || "";
  const response = message.response;

  // Format bold text
  const formatted = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br/>');

  return (
    <div className={`assistant-msg ${isUser ? "user" : "bot"}`}>
      {!isUser && <div className="assistant-msg-avatar">⚖️</div>}
      <div className="assistant-msg-content">
        <div
          className="assistant-msg-text"
          dangerouslySetInnerHTML={{ __html: formatted }}
        />
        {response && response.results && response.results.length > 0 && (
          <AssistantResults results={response.results} />
        )}
      </div>
    </div>
  );
}
