import React, { useEffect } from "react";
import { FiZap, FiX, FiUsers, FiBriefcase, FiCalendar, FiDollarSign, FiFolder, FiCreditCard } from "react-icons/fi";

// Each action navigates to its page and opens that page's "add" form directly.
// `modal` matches the detail string the target page listens for on the
// "assistant-open-modal" window event.
const QUICK_ACTIONS = [
  { icon: <FiUsers />, label: "New Client", route: "/dashboard/clients", modal: "create-client" },
  { icon: <FiBriefcase />, label: "New Case", route: "/dashboard/cases", modal: "create-case" },
  { icon: <FiCalendar />, label: "New Hearing", route: "/dashboard/hearings", modal: "create-hearing" },
  { icon: <FiDollarSign />, label: "Generate Invoice", route: "/dashboard/invoices", modal: "create-invoice" },
  { icon: <FiFolder />, label: "Upload Document", route: "/dashboard/documents", modal: "upload-document" },
  { icon: <FiCreditCard />, label: "Add Expense", route: "/dashboard/expenses", modal: "create-expense" },
];

export default function QuickActionsModal({ isOpen, onClose, onAction }) {
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="search-modal-overlay" onClick={onClose}>
      <div className="global-search-modal" onClick={(e) => e.stopPropagation()}>
        <div className="global-search-input" style={{ cursor: "default" }}>
          <FiZap className="global-search-input-icon" />
          <span style={{ flex: 1, fontWeight: 600 }}>Quick Actions</span>
          <button className="global-search-clear" onClick={onClose} title="Close">
            <FiX />
          </button>
        </div>

        <div className="global-search-body">
          <div className="global-search-recent">
            <div className="global-search-section-label">
              <FiZap className="gs-section-icon" />
              Create
            </div>
            <div className="gs-quick-actions">
              {QUICK_ACTIONS.map((qa, idx) => (
                <button
                  key={idx}
                  className="gs-quick-action-btn"
                  onClick={() => onAction(qa.route, qa.modal)}
                >
                  <span className="gs-qa-icon">{qa.icon}</span>
                  <span className="gs-qa-label">{qa.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="global-search-footer">
          <span className="gs-footer-nav">
            <kbd>Esc</kbd> Close
          </span>
        </div>
      </div>
    </div>
  );
}
