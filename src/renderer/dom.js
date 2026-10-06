// Small helpers shared by all views.

/** Creates an element; `text` goes in as text, never as HTML. */
export function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Creates a button (type="button") that calls `onClick`. */
export function button(label, className, onClick) {
  const node = element('button', className ? `btn ${className}` : 'btn', label);
  node.type = 'button';
  if (onClick) node.addEventListener('click', onClick);
  return node;
}

/** Sum of a numeric field over a list. */
export const sum = (items, field) => items.reduce((total, item) => total + item[field], 0);

/** "1 Eintrag" / "2 Einträge". */
export const count = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** Like count(), with the German thousands dot: "4.470 Einträge". */
export const countDe = (n, one, many) => `${n.toLocaleString('de-DE')} ${n === 1 ? one : many}`;

/** Readable text of a rejected bridge call. */
export const messageOf = (err) => String((err && err.message) || err);
