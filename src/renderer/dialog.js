// In-page confirmation card (no Windows message box): centred on a dimmed
// backdrop. Escape and a click beside the card cancel; the focus starts on
// "Abbrechen", so Enter alone never deletes anything.

const CLOSE_MS = 200;

let open = null;

/**
 * @param {{ title: string, message: string, details?: string[], confirmLabel: string, danger?: boolean }} options
 *   `details` is an optional list of lines shown under the message.
 * @returns {Promise<boolean>} true = confirmed, false = cancelled
 */
export function confirmDialog({ title, message, details = [], confirmLabel, danger = false }) {
  // Only one dialog at a time; a second request while one is open is declined.
  if (open) return Promise.resolve(false);

  return new Promise((resolve) => {
    const previousFocus = document.activeElement;

    const backdrop = document.createElement('div');
    backdrop.className = 'dialog-backdrop';

    const card = document.createElement('div');
    card.className = 'dialog';
    card.setAttribute('role', 'alertdialog');
    card.setAttribute('aria-modal', 'true');
    card.setAttribute('aria-labelledby', 'dialog-title');
    card.setAttribute('aria-describedby', 'dialog-message');

    const heading = document.createElement('h2');
    heading.className = 'dialog-title';
    heading.id = 'dialog-title';
    heading.textContent = title;

    const text = document.createElement('p');
    text.className = 'dialog-message';
    text.id = 'dialog-message';
    text.textContent = message;

    let list = null;
    if (details.length > 0) {
      list = document.createElement('ul');
      list.className = 'dialog-details';
      for (const line of details) {
        const item = document.createElement('li');
        item.textContent = line;
        list.append(item);
      }
    }

    const actions = document.createElement('div');
    actions.className = 'dialog-actions';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'btn';
    cancel.textContent = 'Abbrechen';
    const confirm = document.createElement('button');
    confirm.type = 'button';
    confirm.className = danger ? 'btn btn-danger' : 'btn btn-primary';
    confirm.textContent = confirmLabel;
    actions.append(cancel, confirm);

    card.append(heading, text);
    if (list) card.append(list);
    card.append(actions);
    backdrop.append(card);

    let closed = false;
    const finish = (result) => {
      if (closed) return;
      closed = true;
      document.removeEventListener('keydown', onKeydown, true);
      open = null;
      backdrop.classList.remove('visible');
      setTimeout(() => backdrop.remove(), CLOSE_MS);
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
      resolve(result);
    };

    function onKeydown(event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        finish(false);
      } else if (event.key === 'Tab') {
        // Keep the focus inside the card: only two buttons to cycle through.
        event.preventDefault();
        const next = document.activeElement === cancel ? confirm : cancel;
        next.focus();
      }
    }

    cancel.addEventListener('click', () => finish(false));
    confirm.addEventListener('click', () => finish(true));
    // A click beside the card (on the backdrop itself) cancels.
    backdrop.addEventListener('mousedown', (event) => {
      if (event.target === backdrop) finish(false);
    });
    document.addEventListener('keydown', onKeydown, true);

    open = backdrop;
    document.body.append(backdrop);
    // Next frame: lets the fade-in transition start from the hidden state.
    requestAnimationFrame(() => backdrop.classList.add('visible'));
    cancel.focus();
  });
}
