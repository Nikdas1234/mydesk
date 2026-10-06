// View "Systemmüll": scan the junk categories, pick some, delete them for good.
import { icons } from '../icons.js';
import { helpButton } from '../help.js';
import { registerView } from '../registry.js';
import { store } from '../store.js';
import { formatBytes } from '../format.js';
import { confirmDialog } from '../dialog.js';
import { createProgress, showResult, showError } from '../feedback.js';
import { initialJunkSelection, junkConfirm } from '../view-logic.js';
import { element, sum } from '../dom.js';

// State that must survive switching to another view and back.
let selection = new Set(); // ids of the ticked categories
let selectionFor = null; // the scan result `selection` belongs to
let lastResult = null; // { freedBytes, skipped, declined } of the last clean-up
let cleanError = null;
let redraw = () => {}; // draws the view that is currently on screen

function startScan() {
  lastResult = null;
  cleanError = null;
  store.scan('junk');
}

async function clean(categories) {
  const chosen = categories.filter((cat) => selection.has(cat.id));
  if (chosen.length === 0 || store.isCleaning('junk') || store.getStatus('junk').running) return;
  const { message, details } = junkConfirm(chosen);
  const confirmed = await confirmDialog({
    title: 'Systemmüll löschen?',
    message,
    details,
    confirmLabel: 'Endgültig löschen',
    danger: true,
  });
  if (!confirmed) return;
  // A scan may have been started while the question was open.
  if (store.isCleaning('junk') || store.getStatus('junk').running) return;

  store.setCleaning('junk', true); // locks "Alles prüfen" on the overview, too
  lastResult = null;
  cleanError = null;
  redraw();
  try {
    const { results, declinedIds, unknownIds = [] } = await window.api.junk.clean(chosen.map((cat) => cat.id));
    const labels = new Map(categories.map((cat) => [cat.id, cat.label]));
    lastResult = {
      freedBytes: sum(results, 'freedBytes'),
      skipped: sum(results, 'skipped'),
      declined: declinedIds.map((id) => labels.get(id) ?? id),
      unknown: unknownIds.map((id) => labels.get(id) ?? id),
    };
  } catch (err) {
    cleanError = String((err && err.message) || err);
  }
  store.setCleaning('junk', false);
  redraw();
  await store.scan('junk'); // check again, whatever happened
}

function fileCount(n) {
  return `${n.toLocaleString('de-DE')} ${n === 1 ? 'Datei' : 'Dateien'}`;
}

function buildRow(cat, onToggle) {
  const row = element('label', 'list-row');
  const box = element('input', 'check');
  box.type = 'checkbox';
  box.checked = selection.has(cat.id);
  box.addEventListener('change', () => {
    if (box.checked) selection.add(cat.id);
    else selection.delete(cat.id);
    onToggle();
  });

  const main = element('span', 'list-row-main');
  main.append(element('span', 'list-row-label', cat.label));
  if (cat.admin) main.append(element('span', 'list-row-note', 'benötigt Adminrechte'));
  row.append(box, main);

  if (cat.unreadable) {
    row.append(element('span', 'list-row-size is-note', 'Größe erst mit Adminrechten sichtbar'));
  } else {
    row.append(
      element('span', 'list-row-meta', fileCount(cat.files)),
      element('span', 'list-row-size', formatBytes(cat.bytes)),
    );
  }
  return row;
}

function buildResultCard(categories) {
  if (categories !== selectionFor) {
    selectionFor = categories;
    selection = initialJunkSelection(categories);
  }
  const card = element('div', 'card');
  const list = element('div', 'list');
  const total = element('span', 'card-footer-text');
  const button = element('button', 'btn btn-primary', 'Bereinigen');
  button.type = 'button';

  const updateFooter = () => {
    const chosen = categories.filter((cat) => selection.has(cat.id));
    total.textContent = `${formatBytes(sum(chosen, 'bytes'))} ausgewählt`;
    button.disabled = chosen.length === 0;
  };
  for (const cat of categories) list.append(buildRow(cat, updateFooter));
  button.addEventListener('click', () => clean(categories));
  updateFooter();

  const footer = element('div', 'card-footer');
  footer.append(total, button);
  card.append(list, footer);
  return card;
}

function draw(root) {
  const categories = store.get('junk');
  const status = store.getStatus('junk');
  const cleaning = store.isCleaning('junk');
  const busy = status.running || cleaning;
  root.replaceChildren();

  const header = element('div', 'view-header');
  const viewTitle = element('h1', 'view-title', 'Systemmüll');
  viewTitle.append(helpButton('junk'));
  header.append(viewTitle);
  if (categories !== null && !busy) {
    const again = element('button', 'btn', 'Jetzt prüfen');
    again.type = 'button';
    again.addEventListener('click', startScan);
    header.append(again);
  }
  root.append(header);

  const feedback = element('div', 'feedback');
  const error = cleanError ?? status.error;
  if (lastResult) showResult(feedback, lastResult);
  if (error) showError(feedback, error);
  root.append(feedback);

  if (busy) {
    const card = element('div', 'card');
    card.append(
      cleaning
        ? createProgress({ text: 'Bereinige …' })
        : createProgress({ text: 'Prüfe Systemmüll …', skeleton: true, onCancel: () => store.cancel('junk') }),
    );
    root.append(card);
  } else if (categories === null) {
    const card = element('div', 'card card-empty');
    const start = element('button', 'btn btn-primary', 'Jetzt prüfen');
    start.type = 'button';
    start.addEventListener('click', startScan);
    card.append(element('p', 'text-muted', 'Noch nicht geprüft'), start);
    root.append(card);
  } else {
    root.append(buildResultCard(categories));
  }
}

registerView('junk', {
  title: 'Systemmüll',
  icon: icons.junk,
  render(container) {
    const root = element('div', 'view');
    container.append(root);
    redraw = () => {
      if (root.isConnected) draw(root);
    };
    store.watch(root, ['junk'], redraw);
    draw(root);
  },
});
