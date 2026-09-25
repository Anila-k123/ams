import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "primereact/button";
import { InputText } from "primereact/inputtext";
import "../assets/styles/ChatbotWidget.css";

export default function ChatbotWidget() {
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<{ sender: string; text: string }[]>([
    {
      sender: "bot",
      text: "⚖️ Hello! I am your Antigravity Legal Assistant. How can I help you manage your practice today?",
    },
  ]);
  const [input, setInput] = useState("");
  const chatEndRef = useRef<HTMLDivElement>(null);

  const quickCommands = [
    "Open Dashboard",
    "Open Cases",
    "Open Clients",
    "Show Today's Hearings",
    "Show Pending Cases",
    "Create New Client",
    "Create New Case",
    "Add Expense",
    "Generate Invoice",
    "Generate Report",
  ];

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    const handleToggleOpen = () => setIsOpen(true);
    window.addEventListener("chatbot-toggle-open", handleToggleOpen);
    return () => window.removeEventListener("chatbot-toggle-open", handleToggleOpen);
  }, []);

  const fire = (name: string, detail?: any) =>
    setTimeout(() => {
      window.dispatchEvent(detail === undefined ? new CustomEvent(name) : new CustomEvent(name, { detail }));
    }, 300);

  const handleCommand = (text: string) => {
    setMessages((prev) => [...prev, { sender: "user", text }]);
    setInput("");

    const cleanText = text.toLowerCase().trim();
    let reply = "";

    setTimeout(() => {
      if (cleanText.includes("open dashboard") || cleanText === "dashboard") {
        navigate("/dashboard");
        reply = "Opening your Dashboard overview.";
      } else if (cleanText.includes("open cases") || cleanText === "cases") {
        navigate("/dashboard/cases");
        reply = "Opening Case Management.";
      } else if (cleanText.includes("open clients") || cleanText === "clients") {
        navigate("/dashboard/clients");
        reply = "Opening Client Directory.";
      } else if (cleanText.includes("open expenses") || cleanText === "expenses") {
        navigate("/dashboard/expenses");
        reply = "Opening Expense Tracker.";
      } else if (cleanText.includes("show pending cases") || cleanText.includes("pending cases")) {
        navigate("/dashboard/cases");
        reply = "Filtering for Pending cases...";
        fire("chatbot-filter-cases", "PENDING");
      } else if (cleanText.includes("show today's hearings") || cleanText.includes("today's hearings") || cleanText.includes("today hearings")) {
        navigate("/dashboard/hearings");
        reply = "Opening calendar and displaying today's hearings.";
        fire("chatbot-show-today-hearings");
      } else if (cleanText.startsWith("search client ")) {
        const name = text.substring(14).trim();
        navigate("/dashboard/clients");
        reply = `Searching for client: "${name}"...`;
        fire("chatbot-search-client", name);
      } else if (cleanText.startsWith("search case ")) {
        const caseNum = text.substring(12).trim();
        navigate("/dashboard/cases");
        reply = `Searching for case: "${caseNum}"...`;
        fire("chatbot-search-case", caseNum);
      } else if (cleanText.includes("create new client") || cleanText.includes("create client") || cleanText.includes("add client")) {
        navigate("/dashboard/clients");
        reply = "Opening the New Client form...";
        fire("chatbot-open-create-client");
      } else if (cleanText.includes("create new case") || cleanText.includes("create case") || cleanText.includes("add case")) {
        navigate("/dashboard/cases");
        reply = "Opening the New Case registration form...";
        fire("chatbot-open-create-case");
      } else if (cleanText.includes("add expense") || cleanText.includes("create expense")) {
        navigate("/dashboard/expenses");
        reply = "Opening the Add Expense form...";
        fire("chatbot-open-create-expense");
      } else if (cleanText.includes("generate invoice") || cleanText.includes("create invoice")) {
        navigate("/dashboard/invoices");
        reply = "Opening Invoice generator...";
        fire("chatbot-open-generate-invoice");
      } else if (cleanText.includes("generate report") || cleanText.includes("show reports") || cleanText.includes("open reports")) {
        navigate("/dashboard/reports");
        reply = "Opening PDF Reports Panel.";
      } else {
        reply = `I recognized your query. If you'd like to perform an action, you can use commands like "Open Cases", "Search Client Rahul", or click a quick command below!`;
      }
      setMessages((prev) => [...prev, { sender: "bot", text: reply }]);
    }, 400);
  };

  const handleSend = (e: any) => {
    e.preventDefault();
    if (!input.trim()) return;
    handleCommand(input);
  };

  return (
    <div className="chatbot-widget-container">
      {!isOpen && (
        <Button
          rounded
          icon="pi pi-comments"
          className="chatbot-bubble-btn"
          aria-label="Ask AI Assistant"
          tooltip="Ask AI Assistant"
          tooltipOptions={{ position: "left" }}
          onClick={() => setIsOpen(true)}
        />
      )}

      {isOpen && (
        <div className="chatbot-window">
          <header className="chatbot-header">
            <div className="flex align-items-center gap-2">
              <span className="bot-avatar">⚖️</span>
              <div>
                <h4>Advocate AI Assistant</h4>
                <p>Online Practice Assistant</p>
              </div>
            </div>
            <Button icon="pi pi-times" rounded text className="chatbot-close" aria-label="Close" onClick={() => setIsOpen(false)} />
          </header>

          <div className="chatbot-body">
            <div className="chat-messages">
              {messages.map((m, i) => (
                <div key={i} className={`message-wrapper ${m.sender}`}>
                  <div className="message-bubble">{m.text}</div>
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>

            <div className="quick-commands-grid">
              {quickCommands.map((qc, i) => (
                <Button key={i} rounded outlined size="small" severity="secondary" className="qc-btn"
                  label={qc} icon="pi pi-arrow-right" iconPos="right" onClick={() => handleCommand(qc)} />
              ))}
            </div>
          </div>

          <form onSubmit={handleSend} className="chatbot-input-area">
            <InputText
              className="flex-1"
              placeholder="Ask a command, e.g. Open Cases..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
            />
            <Button type="submit" rounded icon="pi pi-send" aria-label="Send" />
          </form>
        </div>
      )}
    </div>
  );
}
