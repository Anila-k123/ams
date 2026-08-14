import { useWebSocket } from "./useWebSocket";

export function useNotificationListener(handler) {
  useWebSocket("notification", handler);
}

export function useDashboardListener(handler) {
  useWebSocket("dashboard", handler);
}

export function useActivityListener(handler) {
  useWebSocket("activity", handler);
}

export function useHearingAlertListener(handler) {
  useWebSocket("hearing-alert", handler);
}

export function useSearchListener(handler) {
  useWebSocket("search", handler);
}
