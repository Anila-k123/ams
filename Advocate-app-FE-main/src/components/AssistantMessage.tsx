import { useNavigate } from 'react-router-dom';
import { ASSISTANT_NAME } from '../constants/assistant';
import { formatCurrency } from '../utils/formatCurrency';
import Icon from '../ui/Icon';
import { StatusChip } from '../ui/kit';

// Records returned with an answer (cases, clients, invoices ...), one row each.
function AssistantResults({ results }: { results: any[] }) {
  if (!results || results.length === 0) return null;
  return (
    <div className="lisa-results">
      {results.map((item, i) => (
        <div key={item.id || i} className="lisa-result">
          {item.caseNumber && <span className="mono">{item.caseNumber}</span>}
          {item.invoiceNumber && <span className="mono">{item.invoiceNumber}</span>}
          {(item.title || item.name || item.fileName) && <b>{item.title || item.name || item.fileName}</b>}
          {item.title && item.name && <span>{item.name}</span>}
          {item.clientName && <span>{item.clientName}</span>}
          {item.amount != null && <span className="num">{formatCurrency(item.amount)}</span>}
          {item.date && <span>{item.date}</span>}
          {item.time && <span className="mono">{item.time}</span>}
          {item.phone && <span>{item.phone}</span>}
          {item.email && <span>{item.email}</span>}
          {item.category && <span>{item.category}</span>}
          {item.status && <StatusChip status={String(item.status)} />}
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
      html.push(`<div class="h">${bold(heading[1])}</div>`);
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
  const navigate = useNavigate();
  const isUser = message.sender === 'user';
  const response = message.response;

  return (
    <div className={`lisa-msg ${isUser ? 'me' : 'ai'}`}>
      {!isUser && <span className="lisa-seal sm" aria-hidden="true" title={ASSISTANT_NAME}>{ASSISTANT_NAME.charAt(0)}</span>}
      <div className="lisa-bubble">
        <div className="lisa-text" dangerouslySetInnerHTML={{ __html: formatAssistantText(message.text || '') }} />
        {response && response.results && response.results.length > 0 && <AssistantResults results={response.results} />}
        {!isUser && message.links?.length > 0 && (
          <div className="lisa-links">
            {message.links.map((l: any) => (
              <button key={l.route} type="button" className="btn sm" onClick={() => navigate(l.route)}>
                {l.label}<Icon name="chevron" size="sm" />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
