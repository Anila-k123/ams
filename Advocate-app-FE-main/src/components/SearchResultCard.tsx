const SECTION_ICONS: Record<string, string> = {
  clients: 'pi-user',
  cases: 'pi-briefcase',
  hearings: 'pi-calendar',
  documents: 'pi-file',
  expenses: 'pi-wallet',
  invoices: 'pi-indian-rupee',
  payments: 'pi-credit-card',
  tasks: 'pi-check-square',
  events: 'pi-calendar',
};

function getDisplayTitle(section: string, item: any) {
  switch (section) {
    case 'clients': return item.name;
    case 'cases': return item.caseTitle || item.caseNumber;
    case 'hearings':
    case 'events': return item.title;
    case 'documents': return item.documentName || item.originalName;
    case 'invoices': return item.invoiceNumber;
    case 'expenses': return item.title;
    case 'payments': return `Payment #${item.id}`;
    case 'tasks': return item.title;
    default: return '';
  }
}

function getDisplaySubtitle(section: string, item: any) {
  switch (section) {
    case 'clients': return item.email || item.phone || '';
    case 'cases': return `${item.caseNumber || ''} ${item.status ? `- ${item.status}` : ''}`;
    case 'hearings':
    case 'events': return item.eventType ? `${item.eventType} ${item.date ? `- ${item.date}` : ''}` : item.date || '';
    case 'documents': return item.category || item.fileType || item.originalName || '';
    case 'invoices': return `${item.status || ''} ${item.amount ? `- ₹${item.amount}` : ''}`;
    case 'expenses': return item.category ? `${item.category} ${item.amount ? `- ₹${item.amount}` : ''}` : item.amount ? `₹${item.amount}` : '';
    case 'payments': return `${item.paymentMode || ''} ${item.amount ? `- ₹${item.amount}` : ''}${item.clientName ? ` - ${item.clientName}` : ''}`;
    case 'tasks': return item.completed ? 'Completed' : item.priority || '';
    default: return '';
  }
}

interface Props { section: string; item: any; isSelected?: boolean; onClick?: () => void; onMouseEnter?: () => void }

export default function SearchResultCard({ section, item, isSelected, onClick, onMouseEnter }: Props) {
  return (
    <div className={`search-result-item ${isSelected ? 'selected' : ''}`} onClick={onClick} onMouseEnter={onMouseEnter}>
      <div className="search-result-icon"><i className={`pi ${SECTION_ICONS[section] || 'pi-search'}`} /></div>
      <div className="search-result-text">
        <div className="search-result-title">{getDisplayTitle(section, item)}</div>
        <div className="search-result-subtitle">{getDisplaySubtitle(section, item)}</div>
      </div>
    </div>
  );
}
