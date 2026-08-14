import { useEffect, useRef } from "react";
import { useWebSocketContext } from "../contexts/realtime/WebSocketProvider";

export function useWebSocket(channel, handler) {
  const { subscribe } = useWebSocketContext();
  const handlerRef = useRef(handler);

  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  useEffect(() => {
    const unsub = subscribe(channel, (event) => {
      handlerRef.current(event);
    });
    return unsub;
  }, [channel, subscribe]);
}
