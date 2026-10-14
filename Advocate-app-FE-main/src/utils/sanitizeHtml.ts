import DOMPurify from "dompurify";

// The one place HTML from outside the app is cleaned before React renders it
// with dangerouslySetInnerHTML: Word files converted by mammoth (uploaded by
// anyone, including files received from the other side via Import changes) and
// Acts text from India Code. Every such sink must go through sanitizeHtml.
//
// Kept: ordinary document markup (paragraphs, headings, lists, tables, emphasis,
// links, images). Removed: scripts, styles, iframes/objects/forms, event
// handlers, and any link or image source that isn't http(s), mailto, a page
// anchor or an inline image (mammoth embeds images as data:image/...).

const SAFE_URI = /^(?:https?:|mailto:|#|data:image\/(?:png|jpe?g|gif|webp);base64,)/i;

let hooked = false;
function ensureHooks() {
  if (hooked) return;
  hooked = true;
  DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    for (const attr of ["href", "src", "xlink:href"]) {
      const value = node.getAttribute(attr);
      if (value !== null && !SAFE_URI.test(value.trim())) node.removeAttribute(attr);
    }
    // Links open outside the app and can't reach back into it.
    if (node.tagName === "A" && node.getAttribute("href")) {
      node.setAttribute("target", "_blank");
      node.setAttribute("rel", "noopener noreferrer");
    }
  });
}

export function sanitizeHtml(html: string | null | undefined): string {
  if (!html) return "";
  ensureHooks();
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ["style", "form", "input", "button", "textarea", "select", "iframe", "object", "embed", "svg", "math"],
    FORBID_ATTR: ["style"],
    ADD_ATTR: ["target"],
  });
}
