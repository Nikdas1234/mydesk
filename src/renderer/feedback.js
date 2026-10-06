// Small building blocks for progress, results and errors, shared by the views.
import { formatBytes } from './format.js';

/**
 * Text of the result line: "8,4 GB freigegeben · 2 übersprungen · Papierkorb
 * nicht bereinigt – Adminrechte wurden abgelehnt".
 * @param {{ freedBytes: number, skipped?: number, declined?: string[], unknown?: string[] }} result
 *   `declined` holds the labels of the categories that were not cleaned;
 *   `unknown` those whose outcome could not be read (they may have run).
 */
export function resultText({ freedBytes, skipped = 0, declined = [], unknown = [] }) {
  let text = `${formatBytes(freedBytes)} freigegeben`;
  if (skipped > 0) text += ` · ${skipped} übersprungen`;
  if (declined.length > 0) {
    text += ` · ${declined.join(', ')} nicht bereinigt – Adminrechte wurden abgelehnt`;
  }
  if (unknown.length > 0) {
    text += ` · ${unknown.join(', ')}: Ergebnis unbekannt – bitte neu prüfen`;
  }
  return text;
}

// Replaces the previous element of the same kind inside `container`, so a line
// is never shown twice. The new element goes first.
function putLine(container, className, text) {
  container.querySelector(`:scope > .${className}`)?.remove();
  const line = document.createElement('p');
  line.className = className;
  line.textContent = text;
  container.prepend(line);
  return line;
}

/** Shows the result line of a clean-up at the top of `container`. */
export function showResult(container, result) {
  const line = putLine(container, 'result-line', resultText(result));
  line.setAttribute('role', 'status');
  return line;
}

/** Shows a plain status line (same look as a result line) at the top of `container`. */
export function showNote(container, text) {
  const line = putLine(container, 'result-line', text);
  line.setAttribute('role', 'status');
  return line;
}

/** Shows an error line (in the danger colour) at the top of `container`. */
export function showError(container, message) {
  const line = putLine(container, 'error-line', message);
  line.setAttribute('role', 'alert');
  return line;
}

/**
 * Status row: moving bar, text and (if `onCancel` is given) a "Abbrechen" button.
 * The scans report no percentage, so the bar is indeterminate.
 * With `skeleton`, grey placeholder rows with a shimmer stand below it, where
 * the list will appear.
 * @returns {HTMLElement} the block; `block.setText(text)` changes the text
 */
export function createProgress({ text, onCancel, skeleton = false }) {
  const block = document.createElement('div');
  block.className = 'progress-block';
  block.setAttribute('role', 'status');
  const row = document.createElement('div');
  row.className = 'progress-row';
  block.append(row);

  const body = document.createElement('div');
  body.className = 'progress-body';
  const label = document.createElement('div');
  label.className = 'progress-text';
  label.textContent = text;
  const track = document.createElement('div');
  track.className = 'progress';
  const bar = document.createElement('div');
  bar.className = 'progress-bar';
  track.append(bar);
  body.append(label, track);
  row.append(body);

  if (onCancel) {
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'btn';
    cancel.textContent = 'Abbrechen';
    cancel.addEventListener('click', () => {
      cancel.disabled = true;
      onCancel();
    });
    row.append(cancel);
  }

  if (skeleton) {
    const rows = document.createElement('div');
    rows.className = 'skeleton';
    rows.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < 4; i += 1) {
      const line = document.createElement('div');
      line.className = 'skeleton-row';
      line.append(document.createElement('span'), document.createElement('span'));
      rows.append(line);
    }
    block.append(rows);
  }

  block.setText = (next) => {
    label.textContent = next;
  };
  return block;
}
