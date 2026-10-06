import { registerView, showView } from '../registry.js';
import { icons } from '../icons.js';
import { store } from '../store.js';
import { element, button, messageOf } from '../dom.js';
import { createProgress, showError, showNote } from '../feedback.js';
import { formatDate, accountErrorText } from '../view-logic.js';
import { mailProgressText, loadAccounts } from './mail-shared.js';

// Kept while the user switches views.
let selectedKey = null; // "<account>|<uid>" of the mail shown on the right
let reader = { key: null, text: null, error: null, loading: false };
let note = null;
let redraw = () => {};

const keyOf = (mail) => `${mail.account}|${mail.uid}`;

async function openMail(mail) {
  const key = keyOf(mail);
  selectedKey = key;
  reader = { key, text: null, error: null, loading: true };
  redraw();
  try {
    const text = await window.api.mail.text({ account: mail.account, uid: mail.uid });
    if (reader.key === key) reader = { key, text, error: null, loading: false };
  } catch (err) {
    if (reader.key === key) reader = { key, text: null, error: messageOf(err), loading: false };
  }
  redraw();
}

function startScan() {
  note = null;
  selectedKey = null;
  reader = { key: null, text: null, error: null, loading: false };
  store.scan('mail');
}

function buildRow(mail) {
  const row = element('button', 'mail-row');
  row.type = 'button';
  if (!mail.seen) row.classList.add('is-unread');
  if (keyOf(mail) === selectedKey) row.classList.add('is-selected');
  const top = element('span', 'mail-row-top');
  top.append(
    element('span', 'mail-sender truncate', mail.fromName || mail.fromAddress),
    element('span', 'mail-date', formatDate(mail.date)),
  );
  row.append(
    top,
    element('span', 'mail-subject truncate', mail.subject || '(kein Betreff)'),
    element('span', 'mail-meta truncate', `${mail.address} · ${mail.reason ?? ''}`),
  );
  row.addEventListener('click', () => openMail(mail));
  return row;
}

function buildReader(mail) {
  const card = element('div', 'card mail-reader');
  if (!mail) {
    card.append(element('p', 'text-muted', 'Wähle links eine Mail aus, um sie zu lesen.'));
    return card;
  }
  card.append(
    element('h2', 'mail-reader-subject', mail.subject || '(kein Betreff)'),
    element('p', 'mail-meta', `${mail.fromName ? `${mail.fromName} · ` : ''}${mail.fromAddress} · ${formatDate(mail.date)}`),
  );
  const actions = element('div', 'mail-reader-actions');
  actions.append(button('Im Bereich „Einordnen“ ändern', 'btn-small', () => showView('sort')));
  card.append(actions);
  if (reader.loading) card.append(element('p', 'text-muted', 'Mail wird geladen …'));
  else if (reader.error) card.append(element('p', 'error-line', reader.error));
  else card.append(element('div', 'mail-text', reader.text ?? ''));
  return card;
}

function draw(root, accounts) {
  const result = store.get('mail');
  const status = store.getStatus('mail');
  root.replaceChildren();

  const header = element('div', 'view-header');
  header.append(element('h1', 'view-title', 'Wichtige Mails'));
  if (result !== null && !status.running) header.append(button('Jetzt prüfen', '', startScan));
  root.append(header);

  const feedback = element('div', 'feedback');
  if (note) showNote(feedback, note);
  if (status.error) showError(feedback, status.error);
  root.append(feedback);

  if (result && result.errors.length > 0) {
    const notes = element('div', 'notes');
    for (const error of result.errors) notes.append(element('p', 'error-line', accountErrorText(error)));
    root.append(notes);
  }

  if (status.running) {
    const card = element('div', 'card');
    const progress = createProgress({ text: mailProgressText(), skeleton: true, onCancel: () => store.cancel('mail') });
    progress.dataset.mailProgress = 'true';
    card.append(progress);
    root.append(card);
  } else if (accounts !== null && accounts.length === 0) {
    const card = element('div', 'card card-empty');
    card.append(
      element('p', 'text-muted', 'Noch kein Postfach eingerichtet.'),
      button('Zu den Einstellungen', 'btn-primary', () => showView('settings')),
    );
    root.append(card);
  } else if (result === null) {
    const card = element('div', 'card card-empty');
    card.append(element('p', 'text-muted', 'Noch nicht geprüft'), button('Jetzt prüfen', 'btn-primary', startScan));
    root.append(card);
  } else if (result.important.length === 0) {
    const card = element('div', 'card card-empty');
    card.append(element('p', 'text-muted', `Keine wichtigen Mails in den letzten ${result.sinceDays ?? 90} Tagen.`));
    root.append(card);
  } else {
    const layout = element('div', 'mail-layout');
    const list = element('div', 'card mail-list');
    for (const mail of result.important) list.append(buildRow(mail));
    const selected = result.important.find((mail) => keyOf(mail) === selectedKey) ?? null;
    layout.append(list, buildReader(selected));
    root.append(layout);
  }
}

registerView('important', {
  title: 'Wichtige Mails',
  icon: icons.important,
  render(container) {
    const root = element('div', 'view');
    container.append(root);
    let accounts = null;
    redraw = () => {
      if (root.isConnected) draw(root, accounts);
    };
    store.watch(root, ['mail'], redraw);
    draw(root, accounts);
    loadAccounts().then((list) => {
      accounts = list;
      redraw();
    });
  },
});
