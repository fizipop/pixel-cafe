// Text helpers shared by the server and the browser.
//
// Chat and names are HTML-escaped on the SERVER before they are stored or sent, so even a
// client that renders them with innerHTML is safe. The browser then shows them as plain text
// (React text nodes / Phaser text), after turning the five entities back into characters.

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const UNESC: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'" };

export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ESC[c]);

/** Only for display as plain text. Never feed the result to innerHTML. */
export const unescapeHtml = (s: string) => s.replace(/&(amp|lt|gt|quot|#39);/g, (m) => UNESC[m]);

/** Strip control characters, collapse whitespace, trim. */
export const cleanLine = (raw: string) => raw.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
