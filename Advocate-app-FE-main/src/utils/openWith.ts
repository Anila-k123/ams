import api from "../api/client";

/**
 * Desktop editing (docs/DESKTOP_EDITING.md). A web page can't see which programs are installed, so it
 * tries: it opens the file's desktop link (ms-word: etc.; Windows itself asks which installed program, Word
 * or LibreOffice, when several can), and if the page loses focus within a few seconds a program started.
 * Each computer remembers (browser storage) whether that worked, the user's remembered "open with" choice,
 * and their remembered save choice.
 */

export type DesktopLinks = {
  url: string; editable: boolean; ext: string; name: string;
  libreoffice: string; office?: string; officeApp?: string;
};
export type Opener = "desktop" | "pactpro";
export type SaveChoice = { pactpro: boolean; copy: boolean };

const PREFS = "pactpro.openWith";
const SAVE = "pactpro.saveChoice";

type Prefs = { remembered?: Opener; worked?: boolean };

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;   // private window / blocked storage: behave as a new computer
  }
}
function write(key: string, value: unknown) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch { /* not remembered on this computer */ }
}

export function openPrefs(): Prefs {
  const p = read<{ remembered?: string; worked?: unknown }>(PREFS) || {};
  // Earlier builds remembered a program ("office" / "libreoffice"); both now mean "desktop".
  const remembered = p.remembered === "pactpro" ? "pactpro" : p.remembered ? "desktop" : undefined;
  return { remembered, worked: typeof p.worked === "boolean" ? p.worked : undefined };
}
export const rememberOpener = (o: Opener | null) => write(PREFS, { ...openPrefs(), remembered: o || undefined });
export const markWorked = (worked: boolean) => write(PREFS, { ...openPrefs(), worked });

/** The link that opens this file on the desktop: the Office scheme (Windows offers every program registered
 * for it, LibreOffice included), else LibreOffice's own. */
export const desktopLink = (links: DesktopLinks) => links.office || links.libreoffice;

export const savedChoice = (): SaveChoice | null => read<SaveChoice>(SAVE);
export const rememberSaveChoice = (c: SaveChoice | null) => write(SAVE, c);

/** Phones and tablets have no desktop editor that speaks these links: always the PactPro editor. */
export const isMobile = () => /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);

export const desktopLinks = (kind: "doc" | "draft", id: number) =>
  api.get<DesktopLinks>("/api/desktop-links", { params: { kind, id } }).then((r) => r.data);

/** Open a desktop-editor link; resolves true when the program took over (the page lost focus). */
export function launch(link: string, wait = 3000): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    const onLeave = () => finish(true);
    const timer = setTimeout(() => finish(false), wait);
    function finish(ok: boolean) {
      if (done) return;
      done = true;
      window.removeEventListener("blur", onLeave);
      document.removeEventListener("visibilitychange", onLeave);
      clearTimeout(timer);
      resolve(ok);
    }
    window.addEventListener("blur", onLeave);
    document.addEventListener("visibilitychange", onLeave);
    // A hidden frame: an unknown scheme then fails quietly instead of replacing the page.
    const frame = document.createElement("iframe");
    frame.style.display = "none";
    frame.src = link;
    document.body.appendChild(frame);
    setTimeout(() => frame.remove(), wait + 500);
  });
}

/** Save a file to this computer (the browser's download). */
export function saveBlob(blob: Blob, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
}
