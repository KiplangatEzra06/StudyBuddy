export const $ = id => document.getElementById(id);

export function escapeHtml(s) { return String(s ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])); }

export function setStatus(id, text) { $(id).textContent = text; }

export function createSvgElement(tag, attributes = {}) {
  const element = document.createElementNS('http://www.w3.org/2000/svg', tag);
  Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, value));
  return element;
}

export function selectAccessibleName(select, trigger) {
  if (select.getAttribute('aria-label')) return select.getAttribute('aria-label');
  const label = select.labels?.[0];
  if (label) {
    const clone = label.cloneNode(true);
    clone.querySelectorAll('select, .custom-select-wrap').forEach(element => element.remove());
    const text = clone.textContent.trim();
    if (text) return text;
  }
  return trigger.textContent.trim() || 'Choose an option';
}
