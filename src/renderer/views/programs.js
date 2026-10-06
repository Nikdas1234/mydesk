// View "Programme": installed programs, the longest unused first, with the
// button to start their uninstaller.
import { registerView } from '../registry.js';
import { icons } from '../icons.js';
import { store } from '../store.js';
import { formatBytes } from '../format.js';
import { element, button, count, messageOf } from '../dom.js';
import { createProgress, showError, showNote } from '../feedback.js';
import { confirmDialog } from '../dialog.js';
import { lastUsedText, unusedSince } from '../dashboard-logic.js';
import { formatDate } from '../view-logic.js';
import { helpButton } from '../help.js';

const UNUSED_DAYS = 180;

let note = null;
let actionError = null;
let started = new Set(); // ids whose uninstaller was started since the last scan
let startedFor = null;
let redraw = () => {};

function startScan() {
  note = null;
  actionError = null;
  store.scan('programs');
}

async function uninstall(program) {
  const ok = await confirmDialog({
    title: `${program.name} deinstallieren?`,
    message: 'Der Deinstallierer dieses Programms wird gestartet. Folge dort den Schritten; je nach Programm fragt Windows nach Adminrechten.',
    confirmLabel: 'Deinstallieren',
    danger: true,
  });
  if (!ok) return;
  note = null;
  actionError = null;
  try {
    const result = await window.api.programs.uninstall(program.id);
    started.add(program.id);
    note = `Deinstallation von ${result.name} gestartet. Prüfe danach erneut, um die Liste zu aktualisieren.`;
  } catch (err) {
    actionError = messageOf(err);
  }
  redraw();
}

function buildRow(program, now) {
  const row = element('div', 'list-row program-row');
  const stale = program.lastUsedMs !== null && now - program.lastUsedMs >= UNUSED_DAYS * 86_400_000;
  const main = element('span', 'list-row-main');
  main.append(
    element('span', 'list-row-label truncate', program.name),
    element('span', 'list-row-note truncate', [program.publisher, program.version && `Version ${program.version}`,
      program.installedMs && `installiert am ${formatDate(program.installedMs)}`].filter(Boolean).join(' · ')),
  );
  const used = element('span', stale ? 'list-row-meta is-stale' : 'list-row-meta', lastUsedText(program.lastUsedMs, now));
  const size = element('span', 'list-row-size', program.sizeBytes === null ? '–' : formatBytes(program.sizeBytes));
  const remove = button(started.has(program.id) ? 'Gestartet' : 'Deinstallieren', 'btn-small', () => uninstall(program));
  remove.disabled = started.has(program.id);
  row.append(main, used, size, remove);
  return row;
}

function draw(root) {
  const programs = store.get('programs');
  const status = store.getStatus('programs');
  if (programs !== startedFor) {
    startedFor = programs;
    started = new Set();
  }
  root.replaceChildren();

  const header = element('div', 'view-header');
  const title = element('h1', 'view-title', 'Programme');
  title.append(helpButton('programs'));
  header.append(title);
  if (programs !== null && !status.running) header.append(button('Jetzt prüfen', '', startScan));
  root.append(header);

  const feedback = element('div', 'feedback');
  if (note) showNote(feedback, note);
  const error = actionError ?? status.error;
  if (error) showError(feedback, error);
  root.append(feedback);

  if (status.running) {
    const card = element('div', 'card');
    card.append(createProgress({ text: 'Lese installierte Programme …', skeleton: true, onCancel: () => store.cancel('programs') }));
    root.append(card);
  } else if (programs === null) {
    const card = element('div', 'card card-empty');
    card.append(element('p', 'text-muted', 'Noch nicht geprüft'), button('Jetzt prüfen', 'btn-primary', startScan));
    root.append(card);
  } else if (programs.length === 0) {
    const card = element('div', 'card card-empty');
    card.append(element('p', 'text-muted', 'Keine installierten Programme gefunden.'));
    root.append(card);
  } else {
    const now = Date.now();
    const unused = unusedSince(programs, UNUSED_DAYS, now);
    root.append(element('p', 'text-muted sort-hint',
      `${count(programs.length, 'Programm', 'Programme')}, davon ${unused} seit über 6 Monaten nicht benutzt. Die am längsten nicht benutzten stehen oben.`));
    const card = element('div', 'card');
    const list = element('div', 'list is-programs');
    for (const program of programs) list.append(buildRow(program, now));
    card.append(list);
    root.append(card);
  }
}

registerView('programs', {
  title: 'Programme',
  icon: icons.programs,
  render(container) {
    const root = element('div', 'view');
    container.append(root);
    redraw = () => {
      if (root.isConnected) draw(root);
    };
    store.watch(root, ['programs'], redraw);
    draw(root);
  },
});
