import { useState, useCallback } from "react";

export function useDownload() {
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadMessage, setDownloadMessage] = useState("");

  const withDownload = useCallback(async (promiseOrFn, msg = "Downloading...") => {
    setIsDownloading(true);
    setDownloadMessage(msg);
    try {
      return await (typeof promiseOrFn === "function" ? promiseOrFn() : promiseOrFn);
    } finally {
      setIsDownloading(false);
      setDownloadMessage("");
    }
  }, []);

  return { isDownloading, downloadMessage, withDownload };
}
