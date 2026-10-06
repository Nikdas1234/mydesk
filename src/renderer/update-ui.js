// Everything the user sees about updates: the card in the middle of the
// window, the dot at the settings entry, and the change log after an update.
import { needsUpdateBadge, changelogSince } from './dashboard-logic.js';
import { CHANGELOG } from './changelog.js';
import { infoDialog } from './info-dialog.js';

let card = null; // the open update card: { backdrop, text, bar, action, later }
let state = null;
let dismissedVersion = null; // the user chose "Später" for this version
const listeners = new Set();

/** Calls `callback(state)` on every change of the update state. */
export function onUpdateState(callback) {
  listeners.add(callback);
  if (state) callback(state);
  return () => listeners.delete(callback);
}

function closeCard() {
  if (!card) return;
  const { backdrop } = card;
  card = null;
  backdrop.classList.remove('visible');
  setTimeout(() => backdrop.remove(), 200);
}

function openCard() {
  if (card) return;
  const backdrop = document.createElement('div');
  backdrop.className = 'dialog-backdrop';
  const box = document.createElement('div');
  box.className = 'dialog dialog-update';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-label', 'Update');

  const title = document.createElement('h2');
  title.className = 'dialog-title';
  title.textContent = 'Update verfügbar';
  const text = document.createElement('p');
  text.className = 'dialog-message';
  const track = document.createElement('div');
  track.className = 'update-track';
  const bar = document.createElement('div');
  bar.className = 'update-bar';
  track.append(bar);

  const actions = document.createElement('div');
  actions.className = 'dialog-actions';
  const later = document.createElement('button');
  later.type = 'button';
  later.className = 'btn';
  later.textContent = 'Später';
  const action = document.createElement('button');
  action.type = 'button';
  action.className = 'btn btn-primary';
  actions.append(later, action);
  box.append(title, text, track, actions);
  backdrop.append(box);

  later.addEventListener('click', () => {
    dismissedVersion = state?.version ?? null;
    closeCard();
  });
  action.addEventListener('click', async () => {
    action.disabled = true;
    try {
      if (state.status === 'ready') await window.api.update.install();
      else await window.api.update.download();
    } catch (err) {
      text.textContent = String((err && err.message) || err);
      action.disabled = false;
    }
  });

  card = { backdrop, text, track, bar, action, later };
  document.body.append(backdrop);
  requestAnimationFrame(() => backdrop.classList.add('visible'));
  action.focus();
}

function drawCard() {
  if (!card) return;
  const { text, track, bar, action } = card;
  if (state.status === 'available') {
    text.textContent = `Version ${state.version} ist da. Du nutzt Version ${state.currentVersion}.`;
    track.hidden = true;
    action.textContent = 'Herunterladen';
    action.disabled = false;
  } else if (state.status === 'downloading') {
    text.textContent = `Version ${state.version} wird geladen … ${state.percent ?? 0} %`;
    track.hidden = false;
    bar.style.width = `${state.percent ?? 0}%`;
    action.textContent = 'Wird geladen …';
    action.disabled = true;
  } else if (state.status === 'ready') {
    text.textContent = `Version ${state.version} ist geladen. Zum Installieren startet das Programm neu.`;
    track.hidden = true;
    action.textContent = 'Neu starten und installieren';
    action.disabled = false;
  } else if (state.status === 'error') {
    text.textContent = `Das Update konnte nicht geladen werden: ${state.message}`;
    track.hidden = true;
    action.textContent = 'Herunterladen';
    action.disabled = true;
  } else {
    closeCard();
  }
}

function handle(next) {
  state = next;
  // The card opens by itself once per version; after "Später" only the dot
  // at the settings entry and the button there remain.
  if (needsUpdateBadge(state) && state.version !== dismissedVersion) openCard();
  drawCard();
  for (const callback of [...listeners]) callback(state);
}

/** Opens the update card again (button in the settings). */
export function showUpdateCard() {
  if (!needsUpdateBadge(state)) return;
  dismissedVersion = null;
  openCard();
  drawCard();
}

/** Starts listening for update news. */
export function startUpdateUi() {
  window.api.update.onChange(handle);
  window.api.update.state().then(handle).catch(() => {});
}

/** "Was ist neu" as a card; `entries` defaults to the whole change log. */
export function showChangelog(entries = CHANGELOG, title = 'Was ist neu') {
  return infoDialog({
    title,
    sections: entries.map((entry) => ({ heading: `Version ${entry.version} · ${entry.date}`, lines: entry.items })),
    closeLabel: 'Verstanden',
  });
}

/**
 * After an update (and on the very first start): shows what changed since
 * the version seen last, then remembers the running version.
 */
export async function showChangelogIfNew() {
  try {
    const [settings, update] = await Promise.all([window.api.settings.get(), window.api.update.state()]);
    const current = update.currentVersion;
    if (settings.lastSeenVersion === current) return;
    const entries = changelogSince(CHANGELOG, settings.lastSeenVersion, current);
    await window.api.settings.set({ lastSeenVersion: current });
    if (entries.length > 0) await showChangelog(entries, `Neu in MyDesk ${current}`);
  } catch {
    // The change log is a courtesy; a failure must not disturb the start.
  }
}
