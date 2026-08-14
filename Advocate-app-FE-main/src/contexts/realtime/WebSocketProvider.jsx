import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from "react";
import { Client } from "@stomp/stompjs";

const WebSocketContext = createContext(null);

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8080";
const WS_URL = API_BASE.replace(/^http/, "ws") + "/ws";

export function WebSocketProvider({ children }) {
  const [status, setStatus] = useState("disconnected");
  const stompRef = useRef(null);
  const subscriptionsRef = useRef([]);
  const listenersRef = useRef({});
  const tokenRef = useRef(localStorage.getItem("token"));

  useEffect(() => {
    tokenRef.current = localStorage.getItem("token");
  });

  const notify = useCallback((channel, event) => {
    const handlers = listenersRef.current[channel] || [];
    handlers.forEach((fn) => fn(event));
  }, []);

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) {
      setStatus("disconnected");
      return;
    }

    const stomp = new Client({
      brokerURL: WS_URL,
      connectHeaders: { Authorization: `Bearer ${token}` },
      heartbeatIncoming: 10000,
      heartbeatOutgoing: 10000,
      reconnectDelay: 5000,
      onConnect: () => {
        setStatus("connected");
        const subs = [
          stomp.subscribe("/user/queue/notifications", (msg) => {
            notify("notification", JSON.parse(msg.body));
          }),
          stomp.subscribe("/user/queue/dashboard", (msg) => {
            notify("dashboard", JSON.parse(msg.body));
          }),
          stomp.subscribe("/user/queue/activity", (msg) => {
            notify("activity", JSON.parse(msg.body));
          }),
          stomp.subscribe("/user/queue/search", (msg) => {
            notify("search", JSON.parse(msg.body));
          }),
          stomp.subscribe("/user/queue/hearing-alert", (msg) => {
            notify("hearing-alert", JSON.parse(msg.body));
          }),
        ];
        subscriptionsRef.current = subs;
      },
      onDisconnect: () => {
        setStatus("disconnected");
      },
      onStompError: () => {
        setStatus("reconnecting");
      },
      onWebSocketClose: () => {
        setStatus("reconnecting");
      },
    });

    stomp.activate();
    stompRef.current = stomp;

    return () => {
      subscriptionsRef.current.forEach((s) => s.unsubscribe());
      subscriptionsRef.current = [];
      if (stompRef.current) {
        stompRef.current.deactivate();
        stompRef.current = null;
      }
      setStatus("disconnected");
    };
  }, [notify]);

  const subscribe = useCallback((channel, handler) => {
    if (!listenersRef.current[channel]) {
      listenersRef.current[channel] = [];
    }
    listenersRef.current[channel].push(handler);
    return () => {
      const handlers = listenersRef.current[channel];
      if (handlers) {
        listenersRef.current[channel] = handlers.filter((h) => h !== handler);
      }
    };
  }, []);

  return (
    <WebSocketContext.Provider value={{ status, subscribe }}>
      {children}
    </WebSocketContext.Provider>
  );
}

export function useWebSocketContext() {
  const ctx = useContext(WebSocketContext);
  if (!ctx) throw new Error("useWebSocketContext must be used within WebSocketProvider");
  return ctx;
}
