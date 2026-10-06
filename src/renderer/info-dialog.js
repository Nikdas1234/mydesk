// In-page card for reading: instructions behind a "?" and the change log.
// Same look as the confirmation dialog, but with one button and room for
// headings and bullet points. Escape and a click beside the card close it.

const CLOSE_MS = 200;
let open = null;

/**
 * @param {{ title: string, intro?: string, sections: { heading?: string, lines: string[], numbered?: boolean }[], closeLabel?: string }} options
 * @returns {Promise<void>} resolves when the card was closed
 */
export function infoDialog({ title, intro, sections, closeLabel = 'Schließen' }) {
  if (open) return Promise.resolve();

  return new Promise((resolve) => {
    const previousFocus = document.activeElement;
    const backdrop = document.createElement('div');
    backdrop.className = 'dialog-backdrop';
    const card = document.createElement('div');
    card.className = 'dialog dialog-info';
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');
    card.setAttribute('aria-label', title);

    const heading = document.createElement('h2');
    heading.className = 'dialog-title';
    heading.textContent = title;
    const body = document.createElement('div');
    body.className = 'dialog-body';
    if (intro) {
      const text = document.createElement('p');
      text.className = 'dialog-message';
      text.textContent = intro;
      body.append(text);
    }
    for (const section of sections) {
      if (section.heading) {
        const sub = document.createElement('h3');
        sub.className = 'dialog-subtitle';
        sub.textContent = section.heading;
        body.append(sub);
      }
      const list = document.createElement(section.numbered ? 'ol' : 'ul');
      list.className = 'dialog-list';
      for (const line of section.lines) {
        const item = document.createElement('li');
        item.textContent = line;
        list.append(item);
      }
      body.append(list);
    }

    const actions = document.createElement('div');
    actions.className = 'dialog-actions';
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'btn btn-primary';
    close.textContent = closeLabel;
    actions.append(close);
    card.append(heading, body, actions);
    backdrop.append(card);

    let closed = false;
    const finish = () => {
      if (closed) return;
      closed = true;
      document.removeEventListener('keydown', onKeydown, true);
      open = null;
      backdrop.classList.remove('visible');
      setTimeout(() => backdrop.remove(), CLOSE_MS);
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
      resolve();
    };
    function onKeydown(event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        finish();
      } else if (event.key === 'Tab') {
        event.preventDefault();
        close.focus();
      }
    }
    close.addEventListener('click', finish);
    backdrop.addEventListener('mousedown', (event) => {
      if (event.target === backdrop) finish();
    });
    document.addEventListener('keydown', onKeydown, true);

    open = backdrop;
    document.body.append(backdrop);
    requestAnimationFrame(() => backdrop.classList.add('visible'));
    close.focus();
  });
}
