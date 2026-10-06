// View "Einordnen": every mail that is no newsletter, with the two decisions
// "Wichtig" / "Nicht wichtig" right in its row. The program learns from these
// decisions which words make a mail important.
import { registerView, showView } from '../registry.js';
import { icons } from '../icons.js';
import { helpButton } from '../help.js';
import { store } from '../store.js';
import { element, button, messageOf } from '../dom.js';
import { createProgress, showError } from '../feedback.js';
import { formatDate, accountErrorText, learnedText } from '../view-logic.js';
import { mailProgressText, loadAccounts } from './mail-shared.js';

let actionError = null;
let redraw = () => {};

// Clicking the active choice again takes the decision back.
async function decide(mail, important) {
  actionError = null;
  try {
    const next = mail.label === important ? null : important;
    const result = await window.api.mail.label({ account: mail.account, uid: mail.uid, important: next });
    store.set('mail', result);
  } catch (err) {
    actionError = messageOf(err);
    redraw();
  }
}

function buildRow(mail) {
  const row = element('div', 'list-row sort-row');
  if (!mail.seen) row.classList.add('is-unread');

  const main = element('span', 'list-row-main');
  main.append(
    element('span', 'list-row-label truncate', mail.subject || '(kein Betreff)'),
    element('span', 'list-row-note truncate', `${mail.fromName || mail.fromAddress} · ${formatDate(mail.date)} · an ${mail.address}`),
  );

  const verdict = element('span', mail.important ? 'badge' : 'badge is-quiet', mail.important ? 'wichtig' : 'nicht wichtig');
  verdict.title = mail.reason ?? 'Kein Stichwort gefunden';
  const reason = element('span', 'list-row-meta', mail.reason ?? '');

  const actions = element('span', 'sender-actions');
  const yes = button('Wichtig', mail.label === true ? 'btn-small is-chosen' : 'btn-small', () => decide(mail, true));
  const no = button('Nicht wichtig', mail.label === false ? 'btn-small is-chosen' : 'btn-small', () => decide(mail, false));
  yes.setAttribute('aria-pressed', String(mail.label === true));
  no.setAttribute('aria-pressed', String(mail.label === false));
  actions.append(yes, no);

  row.append(main, reason, verdict, actions);
  return row;
}

function draw(root, accounts) {
  const result = store.get('mail');
  const status = store.getStatus('mail');
  root.replaceChildren();

  const header = element('div', 'view-header');
  const viewTitle = element('h1', 'view-title', 'Einordnen');
  viewTitle.append(helpButton('sort'));
  header.append(viewTitle);
  if (result !== null && !status.running) header.append(button('Jetzt prüfen', '', () => store.scan('mail')));
  root.append(header);

  const feedback = element('div', 'feedback');
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
    card.append(
      element('p', 'text-muted', 'Noch nicht geprüft'),
      button('Jetzt prüfen', 'btn-primary', () => store.scan('mail')),
    );
    root.append(card);
  } else {
    root.append(element('p', 'text-muted sort-hint', learnedText(result.learned)));
    if (result.inbox.length === 0) {
      const card = element('div', 'card card-empty');
      card.append(element('p', 'text-muted', `Keine Mails in den letzten ${result.sinceDays} Tagen.`));
      root.append(card);
    } else {
      const card = element('div', 'card');
      const list = element('div', 'list is-sort');
      for (const mail of result.inbox) list.append(buildRow(mail));
      card.append(list);
      root.append(card);
    }
  }
}

registerView('sort', {
  title: 'Einordnen',
  icon: icons.sort,
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
