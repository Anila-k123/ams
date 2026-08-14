import React, { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { FiMessageSquare, FiX, FiSend, FiArrowRight } from "react-icons/fi";
import "../assets/styles/ChatbotWidget.css";

export default function ChatbotWidget() {
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState([
    {
      sender: "bot",
      text: "⚖️ Hello! I am your Antigravity Legal Assistant. How can I help you manage your practice today?",
    },
  ]);
  const [input, setInput] = useState("");
  const chatEndRef = useRef(null);

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

  // Auto-scroll
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Toggle open listener
  useEffect(() => {
    const handleToggleOpen = () => {
      setIsOpen(true);
    };
    window.addEventListener("chatbot-toggle-open", handleToggleOpen);
    return () => {
      window.removeEventListener("chatbot-toggle-open", handleToggleOpen);
    };
  }, []);

  const handleCommand = (text) => {
    const userMsg = { sender: "user", text };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");

    // Simple Intent Recognition
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
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent("chatbot-filter-cases", { detail: "PENDING" }));
        }, 300);
      } else if (cleanText.includes("show today's hearings") || cleanText.includes("today's hearings") || cleanText.includes("today hearings")) {
        navigate("/dashboard/hearings");
        reply = "Opening calendar and displaying today's hearings.";
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent("chatbot-show-today-hearings"));
        }, 300);
      } else if (cleanText.startsWith("search client ")) {
        const name = text.substring(14).trim();
        navigate("/dashboard/clients");
        reply = `Searching for client: "${name}"...`;
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent("chatbot-search-client", { detail: name }));
        }, 300);
      } else if (cleanText.startsWith("search case ")) {
        const caseNum = text.substring(12).trim();
        navigate("/dashboard/cases");
        reply = `Searching for case: "${caseNum}"...`;
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent("chatbot-search-case", { detail: caseNum }));
        }, 300);
      } else if (cleanText.includes("create new client") || cleanText.includes("create client") || cleanText.includes("add client")) {
        navigate("/dashboard/clients");
        reply = "Opening the New Client form...";
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent("chatbot-open-create-client"));
        }, 300);
      } else if (cleanText.includes("create new case") || cleanText.includes("create case") || cleanText.includes("add case")) {
        navigate("/dashboard/cases");
        reply = "Opening the New Case registration form...";
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent("chatbot-open-create-case"));
        }, 300);
      } else if (cleanText.includes("add expense") || cleanText.includes("create expense")) {
        navigate("/dashboard/expenses");
        reply = "Opening the Add Expense form...";
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent("chatbot-open-create-expense"));
        }, 300);
      } else if (cleanText.includes("generate invoice") || cleanText.includes("create invoice")) {
        navigate("/dashboard/invoices");
        reply = "Opening Invoice generator...";
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent("chatbot-open-generate-invoice"));
        }, 300);
      } else if (cleanText.includes("generate report") || cleanText.includes("show reports") || cleanText.includes("open reports")) {
        navigate("/dashboard/reports");
        reply = "Opening PDF Reports Panel.";
      } else {
        // Fallback friendly reply
        reply = `I recognized your query. If you'd like to perform an action, you can use commands like "Open Cases", "Search Client Rahul", or click a quick command below!`;
      }

      setMessages((prev) => [...prev, { sender: "bot", text: reply }]);
    }, 400);
  };

  const handleSend = (e) => {
    e.preventDefault();
    if (!input.trim()) return;
    handleCommand(input);
  };

  return (
    <div className="chatbot-widget-container">
      {/* Chat bubble button */}
      {!isOpen && (
        <button className="chatbot-bubble-btn" onClick={() => setIsOpen(true)}>
          <FiMessageSquare className="chat-icon" />
          <span className="tooltip-text">Ask AI Assistant</span>
        </button>
      )}

      {/* Chat window */}
      {isOpen && (
        <div className="chatbot-window">
          <header className="chatbot-header">
            <div className="bot-profile">
              <span className="bot-avatar">⚖️</span>
              <div>
                <h4>Advocate AI Assistant</h4>
                <p>Online Practice Assistant</p>
              </div>
            </div>
            <button className="close-btn" onClick={() => setIsOpen(false)}>
              <FiX />
            </button>
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

            {/* Quick commands */}
            <div className="quick-commands-grid">
              {quickCommands.map((qc, i) => (
                <button key={i} className="qc-btn" onClick={() => handleCommand(qc)}>
                  {qc} <FiArrowRight className="qc-arrow" />
                </button>
              ))}
            </div>
          </div>

          <form onSubmit={handleSend} className="chatbot-input-area">
            <input
              type="text"
              placeholder="Ask a command, e.g. Open Cases..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
            />
            <button type="submit" className="send-btn">
              <FiSend />
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
