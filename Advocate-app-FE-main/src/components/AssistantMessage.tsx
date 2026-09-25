import { Tag } from 'primereact/tag';
import { formatCurrency } from '../utils/formatCurrency';

function statusSeverity(status: string): any {
  const s = status.toLowerCase();
  if (['paid', 'completed', 'closed', 'active', 'won'].includes(s)) return 'success';
  if (['pending', 'open', 'scheduled', 'partial'].includes(s)) return 'warning';
  if (['overdue', 'cancelled', 'lost', 'failed'].includes(s)) return 'danger';
  return 'info';
}

function AssistantResults({ results }: { results: any[] }) {
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
          {item.status && <Tag className="ar-status" value={item.status} severity={statusSeverity(String(item.status))} />}
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

function escapeHtml(str: string) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function bold(str: string) {
  return str.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}

// Markdown-lite -> HTML: "### Heading" and "* item" lines become headings/bullets.
function formatAssistantText(text: string) {
  const lines = escapeHtml(text).split('\n');
  const html: string[] = [];
  let list: string[] = [];

  const flushList = () => {
    if (list.length) {
      html.push(`<ul>${list.map((li) => `<li>${bold(li)}</li>`).join('')}</ul>`);
      list = [];
    }
  };

  for (const raw of lines) {
    const line = raw.trim();
    const heading = line.match(/^#{1,6}\s+(.*)$/);
    const bullet = line.match(/^[*-]\s+(.*)$/);
    if (heading) {
      flushList();
      html.push(`<div class="assistant-msg-heading">${bold(heading[1])}</div>`);
    } else if (bullet) {
      list.push(bullet[1]);
    } else if (line === '') {
      flushList();
      html.push('<br/>');
    } else {
      flushList();
      html.push(`<div>${bold(line)}</div>`);
    }
  }
  flushList();
  return html.join('');
}

export default function AssistantMessage({ message }: { message: any }) {
  const isUser = message.sender === 'user';
  const response = message.response;

  return (
    <div className={`assistant-msg ${isUser ? 'user' : 'bot'}`}>
      {!isUser && <div className="assistant-msg-avatar"><i className="pi pi-sparkles" /></div>}
      <div className="assistant-msg-content">
        <div className="assistant-msg-text" dangerouslySetInnerHTML={{ __html: formatAssistantText(message.text || '') }} />
        {response && response.results && response.results.length > 0 && <AssistantResults results={response.results} />}
      </div>
    </div>
  );
}
