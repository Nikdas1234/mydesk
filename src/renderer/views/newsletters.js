import { registerView, showView } from '../registry.js';
import { icons } from '../icons.js';
import { helpButton } from '../help.js';
import { store } from '../store.js';
import { element, button, count, messageOf } from '../dom.js';
import { createProgress, showError, showNote } from '../feedback.js';
import { confirmDialog } from '../dialog.js';
import {
  formatDate, accountErrorText, unsubscribeConfirm, removeConfirm, unsubscribeResultText, bulkRemove,
} from '../view-logic.js';
import { mailProgressText, loadAccounts } from './mail-shared.js';

// Kept while the user switches views.
let note = null;
let actionError = null;
let busyKey = null; // sender whose action is running right now
// Senders changed since the last scan: key -> { unsubscribed?, removed? }
let changes = new Map();
let changesFor = null;
let redraw = () => {};

function startScan() {
  note = null;
  actionError = null;
  store.scan('mail');
}

async function run(sender, work) {
  if (busyKey) return;
  busyKey = sender.key;
  note = null;
  actionError = null;
  redraw();
  try {
    await work();
  } catch (err) {
    actionError = messageOf(err);
  }
  busyKey = null;
  redraw();
}

async function unsubscribe(sender) {
  const ok = await confirmDialog({ ...unsubscribeConfirm(sender), danger: false });
  if (!ok) return;
  await run(sender, async () => {
    let result = await window.api.mail.unsubscribe(sender.key);
    if (!result.ok && result.browserAvailable) {
      // The automatic way failed: offer the sender's web link instead.
      const openBrowser = await confirmDialog({
        title: 'Abmeldung fehlgeschlagen',
        message: `${unsubscribeResultText(result)}. Stattdessen den Abmeldelink im Browser öffnen?`,
        confirmLabel: 'Im Browser öffnen',
        danger: false,
      });
      if (openBrowser) result = await window.api.mail.unsubscribeInBrowser(sender.key);
    }
    if (result.ok) changes.set(sender.key, { ...changes.get(sender.key), unsubscribed: result.unsubscribed });
    if (result.ok) note = unsubscribeResultText(result);
    else actionError = unsubscribeResultText(result);
  });
}

async function removeMails(sender) {
  const ok = await confirmDialog({ ...removeConfirm(sender), danger: true });
  if (!ok) return;
  await run(sender, async () => {
    const { moved } = await window.api.mail.removeSender(sender.key);
    changes.set(sender.key, { ...changes.get(sender.key), removed: true });
    note = `${count(moved, 'Mail', 'Mails')} verschoben.`;
  });
}

// Moves the mails of every unsubscribed sender in one go.
async function removeAllUnsubscribed(senders) {
  const plan = bulkRemove(senders, changes);
  if (plan.senders === 0 || busyKey) return;
  const ok = await confirmDialog({ title: 'Mails entfernen?', message: plan.message, confirmLabel: 'Verschieben', danger: true });
  if (!ok) return;
  await run({ key: '*' }, async () => {
    const result = await window.api.mail.removeUnsubscribed();
    for (const key of result.senders) changes.set(key, { ...changes.get(key), removed: true });
    note = `${count(result.moved, 'Mail', 'Mails')} verschoben.`;
    if (result.failed.length > 0) {
      actionError = `${count(result.failed.length, 'Absender', 'Absender')} nicht bearbeitet: ${result.failed[0].message}`;
    }
  });
}

function buildRow(sender) {
  const change = changes.get(sender.key) ?? {};
  const unsubscribed = change.unsubscribed ?? sender.unsubscribed;
  const row = element('div', 'list-row sender-row');
  if (unsubscribed) row.classList.add('is-done');

  const main = element('span', 'list-row-main');
  main.append(
    element('span', 'list-row-label truncate', sender.fromName || sender.fromAddress),
    element('span', 'list-row-note truncate', `${sender.fromAddress} · an ${sender.address}`),
  );
  const state = unsubscribed
    ? `Abgemeldet am ${formatDate(unsubscribed.date)}`
    : sender.method === null ? 'Kein Abmeldeweg angegeben' : '';
  if (state) main.append(element('span', 'list-row-note', state));

  const meta = element('span', 'list-row-meta');
  meta.textContent = change.removed
    ? 'Mails entfernt'
    : `${count(sender.count, 'Mail', 'Mails')} · zuletzt ${formatDate(sender.lastDate)}`;

  const actions = element('span', 'sender-actions');
  const off = button('Abmelden', 'btn-small', () => unsubscribe(sender));
  off.disabled = Boolean(busyKey) || sender.method === null || Boolean(unsubscribed);
  const remove = button('Vorhandene Mails entfernen', 'btn-small', () => removeMails(sender));
  remove.disabled = Boolean(busyKey) || Boolean(change.removed);
  actions.append(off, remove);

  row.append(main, meta, actions);
  return row;
}

function draw(root, accounts) {
  const result = store.get('mail');
  const status = store.getStatus('mail');
  if (result !== changesFor) {
    changesFor = result;
    changes = new Map();
  }
  root.replaceChildren();

  const header = element('div', 'view-header');
  const viewTitle = element('h1', 'view-title', 'Newsletter');
  viewTitle.append(helpButton('newsletters'));
  header.append(viewTitle);
  if (result !== null && !status.running) header.append(button('Jetzt prüfen', '', startScan));
  root.append(header);

  const feedback = element('div', 'feedback');
  if (note) showNote(feedback, note);
  const error = actionError ?? status.error;
  if (error) showError(feedback, error);
  root.append(feedback);

  if (result && result.errors.length > 0) {
    const notes = element('div', 'notes');
    for (const item of result.errors) notes.append(element('p', 'error-line', accountErrorText(item)));
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
  } else if (result.newsletters.length === 0) {
    const card = element('div', 'card card-empty');
    card.append(element('p', 'text-muted', 'Keine Newsletter gefunden.'));
    root.append(card);
  } else {
    const card = element('div', 'card');
    const list = element('div', 'list is-senders');
    for (const sender of result.newsletters) list.append(buildRow(sender));

    const plan = bulkRemove(result.newsletters, changes);
    const footer = element('div', 'bulk-bar');
    const all = button('Alle abgemeldeten in den Papierkorb', 'btn-danger', () => removeAllUnsubscribed(result.newsletters));
    all.disabled = plan.senders === 0 || Boolean(busyKey);
    footer.append(
      element('span', 'card-footer-text', plan.senders === 0
        ? 'Noch kein abgemeldeter Absender mit Mails'
        : `${count(plan.mails, 'Mail', 'Mails')} von ${count(plan.senders, 'abgemeldeten Absender', 'abgemeldeten Absendern')}`),
      all,
    );
    card.append(footer, list);
    root.append(card);
  }
}

registerView('newsletters', {
  title: 'Newsletter',
  icon: icons.newsletters,
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
