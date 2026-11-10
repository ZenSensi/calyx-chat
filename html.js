// Escape untrusted text (names, messages, URLs from Firestore/Auth) before it goes into an
// innerHTML template, either as element content or inside a double/single-quoted attribute.
const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ENTITIES[c]);
}
