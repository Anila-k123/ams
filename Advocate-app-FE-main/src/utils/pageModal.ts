import { useEffect, useRef } from "react";

// "Go to a page and open its add form" (Quick Actions, Lisa's commands).
//
// This used to be navigate() followed by a window event 400-450 ms later. The
// pages are lazy-loaded, so on a first visit (or a slow machine) the event
// fired before the page had mounted its listener, and the form silently
// never opened. Now the request is also parked here, and the page picks it up
// when it mounts; the live event still covers a page that is already open.

const EVENT = "assistant-open-modal";
// A parked request older than this is stale (the user went somewhere else).
const MAX_AGE_MS = 10000;

let pending: { detail: string; at: number } | null = null;

export function requestPageModal(detail: string) {
  pending = { detail, at: Date.now() };
  window.dispatchEvent(new CustomEvent(EVENT, { detail }));
}

/** Open this page's form when asked: now if the page is mounted, or on mount. */
export function usePageModal(details: string[], open: () => void) {
  const openRef = useRef(open);
  openRef.current = open;
  const key = details.join("|");

  useEffect(() => {
    const names = key.split("|");
    const take = (detail: string) => {
      if (!names.includes(detail)) return false;
      pending = null;
      openRef.current();
      return true;
    };
    if (pending && Date.now() - pending.at < MAX_AGE_MS) take(pending.detail);
    const handler = (e: any) => { take(e.detail); };
    window.addEventListener(EVENT, handler);
    return () => window.removeEventListener(EVENT, handler);
  }, [key]);
}
