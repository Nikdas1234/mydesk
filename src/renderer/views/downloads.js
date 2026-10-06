// View "Alte Downloads": list old entries of the Downloads folder, pick some,
// move them to the recycle bin.
import { icons } from '../icons.js';
import { helpButton } from '../help.js';
import { registerView } from '../registry.js';
import { store } from '../store.js';
import { formatBytes } from '../format.js';
import { confirmDialog } from '../dialog.js';
import { createProgress, showResult, showError } from '../feedback.js';
import { element, button, sum, count, countDe, messageOf } from '../dom.js';

// State that must survive switching to another view and back.
let selection = new Set(); // paths of the ticked entries
let selectionFor = null; // the scan result `selection` belongs to
let trashing = false;
let lastResult = null; // { freedBytes, skipped } of the last move
let trashError = null;
let ageDays = null; // setting "older than ... days", for the empty text
let redraw = () => {}; // draws the view that is currently on screen

async function refreshAge() {
  try {
    const settings = await window.api.settings.get();
    if (settings.downloadsMaxAgeDays !== ageDays) {
      ageDays = settings.downloadsMaxAgeDays;
      redraw();
    }
  } catch {
    // Only the wording of the empty text depends on it.
  }
}

function startScan() {
  lastResult = null;
  trashError = null;
  store.scan('downloads');
}

async function moveToTrash(entries) {
  const chosen = entries.filter((entry) => selection.has(entry.path));
  if (chosen.length === 0 || trashing) return;
  const confirmed = await confirmDialog({
    title: 'Alte Downloads entfernen?',
    message: `${countDe(chosen.length, 'Eintrag', 'Einträge')} (${formatBytes(sum(chosen, 'size'))}) in den Papierkorb verschieben?`,
    confirmLabel: 'In den Papierkorb',
    danger: true,
  });
  if (!confirmed) return;

  trashing = true;
  lastResult = null;
  trashError = null;
  redraw();
  try {
    const { freedBytes, skipped } = await window.api.downloads.trash(chosen.map((entry) => entry.path));
    lastResult = { freedBytes, skipped };
    // Files now sit in the recycle bin: an earlier junk check no longer
    // describes it, so the next clean-up needs a new check.
    store.invalidate('junk');
  } catch (err) {
    trashError = messageOf(err);
  }
  trashing = false;
  redraw();
  await store.scan('downloads'); // show the real state, whatever happened
}

async function reveal(root, path) {
  try {
    await window.api.showInFolder(path);
  } catch (err) {
    showError(root.querySelector('.feedback'), messageOf(err));
  }
}

function buildRow(root, entry, onToggle) {
  const row = element('label', 'list-row');
  const box = element('input', 'check');
  box.type = 'checkbox';
  box.checked = selection.has(entry.path);
  box.addEventListener('change', () => {
    if (box.checked) selection.add(entry.path);
    else selection.delete(entry.path);
    onToggle();
  });

  const main = element('span', 'list-row-main is-inline');
  const icon = element('span', 'list-row-icon');
  icon.innerHTML = entry.isDirectory ? icons.folder : icons.file; // trusted static SVG
  const name = element('span', 'list-row-label truncate', entry.name);
  name.title = entry.path;
  main.append(icon, name);

  const age = `${entry.ageDays} ${entry.ageDays === 1 ? 'Tag' : 'Tage'} alt`;
  const show = button('Im Explorer zeigen', 'btn-small', () => reveal(root, entry.path));
  row.append(box, main, element('span', 'list-row-meta', age), element('span', 'list-row-size', formatBytes(entry.size)), show);
  return { row, box };
}

function buildResultCard(root, entries) {
  if (entries !== selectionFor) {
    selectionFor = entries;
    selection = new Set(); // nothing is preselected
  }
  const card = element('div', 'card');
  const all = element('input', 'check');
  all.type = 'checkbox';
  const head = element('label', 'list-head');
  head.append(all, element('span', undefined, 'Alle auswählen'));

  const list = element('div', 'list has-action');
  const total = element('span', 'card-footer-text');
  const trashButton = button('In den Papierkorb', 'btn-primary');
  const rows = [];

  const update = () => {
    const chosen = entries.filter((entry) => selection.has(entry.path));
    total.textContent = `${formatBytes(sum(chosen, 'size'))} ausgewählt`;
    trashButton.disabled = chosen.length === 0;
    all.checked = chosen.length === entries.length;
    all.indeterminate = chosen.length > 0 && chosen.length < entries.length;
  };
  for (const entry of entries) {
    const built = buildRow(root, entry, update);
    rows.push({ entry, box: built.box });
    list.append(built.row);
  }
  all.addEventListener('change', () => {
    for (const { entry, box } of rows) {
      box.checked = all.checked;
      if (all.checked) selection.add(entry.path);
      else selection.delete(entry.path);
    }
    update();
  });
  trashButton.addEventListener('click', () => moveToTrash(entries));
  update();

  const footer = element('div', 'card-footer is-sticky');
  footer.append(total, trashButton);
  card.append(head, list, footer);
  return card;
}

function draw(root) {
  const entries = store.get('downloads');
  const status = store.getStatus('downloads');
  const busy = status.running || trashing;
  root.replaceChildren();

  const header = element('div', 'view-header');
  const viewTitle = element('h1', 'view-title', 'Alte Downloads');
  viewTitle.append(helpButton('downloads'));
  header.append(viewTitle);
  if (entries !== null && !busy) header.append(button('Jetzt prüfen', undefined, startScan));
  root.append(header);

  const feedback = element('div', 'feedback');
  const error = trashError ?? status.error;
  if (lastResult) showResult(feedback, lastResult);
  if (error) showError(feedback, error);
  root.append(feedback);

  if (busy) {
    const card = element('div', 'card');
    card.append(
      trashing
        ? createProgress({ text: 'Verschiebe in den Papierkorb …' })
        : createProgress({ text: 'Prüfe Alte Downloads …', skeleton: true, onCancel: () => store.cancel('downloads') }),
    );
    root.append(card);
  } else if (entries === null) {
    const card = element('div', 'card card-empty');
    card.append(element('p', 'text-muted', 'Noch nicht geprüft'), button('Jetzt prüfen', 'btn-primary', startScan));
    root.append(card);
  } else if (entries.length === 0) {
    const card = element('div', 'card card-empty');
    const days = ageDays === null ? null : count(ageDays, 'Tag', 'Tage');
    card.append(
      element('p', undefined, days === null ? 'Keine alten Downloads gefunden.' : `Keine Downloads, die älter als ${days} sind.`),
    );
    root.append(card);
  } else {
    root.append(buildResultCard(root, entries));
  }
}

registerView('downloads', {
  title: 'Alte Downloads',
  icon: icons.downloads,
  render(container) {
    const root = element('div', 'view');
    container.append(root);
    redraw = () => {
      if (root.isConnected) draw(root);
    };
    store.watch(root, ['downloads'], () => {
      redraw();
      if (!store.getStatus('downloads').running) refreshAge();
    });
    draw(root);
    refreshAge();
  },
});
