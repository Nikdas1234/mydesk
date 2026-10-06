// View "Einstellungen": every change is saved at once.
import { icons } from '../icons.js';
import { registerView } from '../registry.js';
import { store } from '../store.js';
import { showError } from '../feedback.js';
import { element, button, messageOf } from '../dom.js';
import {
  parseNumber, learnedText, updateStatusText,
} from '../view-logic.js';
import { confirmDialog } from '../dialog.js';
import { loadAccounts } from './mail-shared.js';
import { helpButton } from '../help.js';
import { setMotion } from '../motion.js';
import { setStyle } from '../appearance.js';
import { onUpdateState, showUpdateCard, showChangelog } from '../update-ui.js';
import { needsUpdateBadge } from '../dashboard-logic.js';
import { TILES, WIDE_TILES } from './overview.js';

let current = null; // last settings as the main process stored them

function numberRow(labelText, { key, min, max, integer }, save) {
  const row = element('label', 'setting-row');
  const input = element('input', 'number-input');
  input.type = 'number';
  input.min = String(min);
  input.max = String(max);
  input.step = integer ? '1' : 'any';
  input.value = String(current[key]);
  input.setAttribute('aria-label', labelText);
  // Saved when the field is left or Enter is pressed, not on every keystroke.
  input.addEventListener('change', async () => {
    const value = parseNumber(input.value, { min, max, integer });
    if (value !== null && value !== current[key]) await save({ [key]: value });
    input.value = String(current[key]); // invalid or rejected input jumps back
  });
  row.append(element('span', undefined, labelText), input);
  return row;
}

function titleWithHelp(text, topic) {
  const title = element('h2', 'card-title', text);
  title.append(helpButton(topic));
  return title;
}

// One choice out of a few, saved at once.
function choiceRow(labelText, key, options, save, after = () => {}) {
  const row = element('div', 'setting-row');
  const choices = element('div', 'segmented');
  const mark = () => {
    for (const node of choices.children) {
      const on = node.dataset.value === current[key];
      node.classList.toggle('is-on', on);
      node.setAttribute('aria-pressed', String(on));
    }
  };
  for (const [value, label] of options) {
    const node = button(label, 'segmented-item', async () => {
      await save({ [key]: value });
      mark();
      after(current[key]);
    });
    node.dataset.value = value;
    choices.append(node);
  }
  mark();
  row.append(element('span', undefined, labelText), choices);
  return row;
}

// Card "Darstellung": style, colour scheme, animations.
function buildLookCard(save) {
  const card = element('div', 'card settings-card');
  card.append(
    element('h2', 'card-title', 'Darstellung'),
    choiceRow('Stil', 'style', [['classic', 'Schlicht'], ['tinted', 'Farbig'], ['glass', 'Liquid Glass']], save, setStyle),
    choiceRow('Farbschema', 'theme', [['system', 'Wie Windows'], ['light', 'Hell'], ['dark', 'Dunkel']], save),
    switchRow('Animationen', 'animations', save, (on) => setMotion(on)),
  );
  return card;
}

// Card "Startseite": the greeting, its parts, and the tiles.
function buildHomeCard(save) {
  const card = element('div', 'card settings-card');
  card.append(element('h2', 'card-title', 'Startseite'));

  const nameRow = element('label', 'setting-row');
  const name = element('input', 'text-input name-input');
  name.type = 'text';
  name.maxLength = 40;
  name.placeholder = 'z. B. Alex';
  name.value = current.userName;
  name.setAttribute('aria-label', 'Dein Name');
  // Saved when the field is left or Enter is pressed, not on every keystroke.
  name.addEventListener('change', async () => {
    await save({ userName: name.value.trim() });
    name.value = current.userName;
  });
  nameRow.append(element('span', undefined, 'Dein Name für die Begrüßung'), name);

  card.append(
    nameRow,
    switchRow('Begrüßung („Guten Abend, …")', 'homeGreeting', save),
    switchRow('Datum und Uhrzeit', 'homeClock', save),
    switchRow('Zusammenfassung in einem Satz', 'homeSummary', save),
    switchRow('Tipp des Tages', 'homeTip', save),
    switchRow('Beim Start automatisch alles prüfen', 'autoCheckOnStart', save),
    element('p', 'text-muted folder-caption', 'Kacheln auf der Startseite'),
  );
  const tiles = element('div', 'tile-choices');
  for (const tile of [...WIDE_TILES, ...TILES]) {
    const row = element('label', 'tile-choice');
    const box = element('input', 'check');
    box.type = 'checkbox';
    box.checked = !current.hiddenTiles.includes(tile.id);
    box.addEventListener('change', async () => {
      const hidden = current.hiddenTiles.filter((id) => id !== tile.id);
      if (!box.checked) hidden.push(tile.id);
      await save({ hiddenTiles: hidden });
      box.checked = !current.hiddenTiles.includes(tile.id);
    });
    row.append(box, element('span', undefined, tile.title));
    tiles.append(row);
  }
  card.append(tiles);
  return card;
}

// A tick box that saves at once.
function switchRow(labelText, key, save, after = () => {}) {
  const row = element('label', 'setting-row switch-row');
  const box = element('input', 'check');
  box.type = 'checkbox';
  box.checked = current[key] === true;
  box.addEventListener('change', async () => {
    await save({ [key]: box.checked });
    box.checked = current[key] === true;
    after(current[key] === true);
  });
  row.append(element('span', undefined, labelText), box);
  return row;
}

const PROVIDER_LABELS = { gmx: 'GMX', freenet: 'freenet', gmail: 'Gmail' };

// Card "Postfächer": the accounts with test / remove, and the form to add one.
// The password only ever travels from the field to the main process.
function buildAccountsCard(feedback) {
  const card = element('div', 'card settings-card');
  const list = element('div', 'folder-list');
  const status = new Map(); // account id -> text of the last connection test

  async function refresh() {
    const accounts = await loadAccounts();
    list.replaceChildren();
    if (accounts.length === 0) list.append(element('p', 'text-muted', 'Noch kein Postfach eingerichtet.'));
    for (const account of accounts) {
      const row = element('div', 'folder-row');
      const name = element('span', 'folder-name truncate', account.address);
      const hint = element('span', 'folder-hint', status.get(account.id) ?? PROVIDER_LABELS[account.provider] ?? '');
      const test = button('Verbindung testen', 'btn-small', async () => {
        test.disabled = true;
        hint.textContent = 'Wird getestet …';
        try {
          const result = await window.api.mail.accounts.test(account.id);
          const failure = result.hint ? result.message + ' – ' + result.hint : result.message;
          status.set(account.id, result.ok ? 'Verbindung in Ordnung.' : failure);
        } catch (err) {
          status.set(account.id, messageOf(err));
        }
        refresh();
      });
      const remove = button('Entfernen', 'btn-small', async () => {
        const ok = await confirmDialog({
          title: 'Postfach entfernen?',
          message: account.address + ' wird aus dem Programm entfernt. Im Postfach selbst ändert sich nichts.',
          confirmLabel: 'Entfernen',
          danger: true,
        });
        if (!ok) return;
        try {
          await window.api.mail.accounts.remove(account.id);
          store.invalidate('mail');
        } catch (err) {
          showError(feedback, messageOf(err));
        }
        refresh();
      });
      row.append(name, hint, test, remove);
      list.append(row);
    }
  }

  const form = element('form', 'account-form');
  const address = element('input', 'text-input');
  address.type = 'email';
  address.placeholder = 'E-Mail-Adresse';
  address.setAttribute('aria-label', 'E-Mail-Adresse');
  address.autocomplete = 'off';
  const password = element('input', 'text-input');
  password.type = 'password';
  password.placeholder = 'Passwort bzw. App-Passwort';
  password.setAttribute('aria-label', 'Passwort');
  password.autocomplete = 'off';
  const add = element('button', 'btn', 'Konto hinzufügen');
  add.type = 'submit';
  form.append(address, password, add);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await window.api.mail.accounts.save({ address: address.value, password: password.value });
      address.value = '';
      feedback.replaceChildren();
      store.invalidate('mail');
    } catch (err) {
      showError(feedback, messageOf(err));
    }
    password.value = ''; // never keep a password in the page
    refresh();
  });

  card.append(
    titleWithHelp('Postfächer', 'accounts'),
    list,
    form,
    element('p', 'text-muted account-note', 'Unterstützt werden GMX, freenet und Gmail. Das Passwort wird von Windows verschlüsselt gespeichert.'),
  );
  refresh();
  return card;
}

// What the program has learned from the decisions in "Einordnen", and the
// button to forget it again.
function learningRow(feedback) {
  const row = element('div', 'setting-row switch-row');
  const text = element('span', 'text-muted', '');
  const reset = button('Gelerntes zurücksetzen', 'btn-small', async () => {
    const ok = await confirmDialog({
      title: 'Gelerntes zurücksetzen?',
      message: 'Alle Entscheidungen aus „Einordnen“ werden vergessen. Wichtig ist danach wieder, was ein Stichwort enthält oder im Postfach markiert ist.',
      confirmLabel: 'Zurücksetzen',
      danger: true,
    });
    if (!ok) return;
    try {
      const result = await window.api.mail.resetLearning();
      if (result) store.set('mail', result);
    } catch (err) {
      showError(feedback, messageOf(err));
    }
    refresh();
  });
  async function refresh() {
    try {
      const learned = await window.api.mail.learned();
      text.textContent = learnedText(learned);
      reset.disabled = learned.important + learned.other === 0;
    } catch {
      text.textContent = '';
    }
  }
  row.append(text, reset);
  refresh();
  return row;
}

// A list of words or addresses with "Entfernen" per entry and a field to add one.
function listEditor(caption, key, placeholder, save) {
  const box = element('div', 'list-editor');
  const rows = element('div', 'folder-list');
  const fill = () => {
    rows.replaceChildren();
    for (const entry of current[key]) {
      const row = element('div', 'folder-row');
      row.append(
        element('span', 'folder-name truncate', entry),
        button('Entfernen', 'btn-small', async () => {
          await save({ [key]: current[key].filter((item) => item !== entry) });
          fill();
        }),
      );
      rows.append(row);
    }
  };
  const form = element('form', 'account-form');
  const input = element('input', 'text-input');
  input.type = 'text';
  input.placeholder = placeholder;
  input.setAttribute('aria-label', caption);
  const add = element('button', 'btn', 'Hinzufügen');
  add.type = 'submit';
  form.append(input, add);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const value = input.value.trim();
    if (!value) return;
    const known = current[key].some((item) => item.toLowerCase() === value.toLowerCase());
    if (!known) await save({ [key]: [...current[key], value] });
    input.value = '';
    fill();
  });
  fill();
  box.append(element('p', 'text-muted folder-caption', caption), rows, form);
  return box;
}

function draw(root) {
  root.replaceChildren();
  root.append(element('h1', 'view-title', 'Einstellungen'));
  const feedback = element('div', 'feedback');
  root.append(feedback);

  async function save(patch) {
    try {
      current = await window.api.settings.set(patch);
      feedback.replaceChildren();
    } catch (err) {
      showError(feedback, messageOf(err));
    }
  }

  const downloads = element('div', 'card settings-card');
  downloads.append(
    element('h2', 'card-title', 'Alte Downloads'),
    numberRow('Älter als … Tage', { key: 'downloadsMaxAgeDays', min: 1, max: 3650, integer: true }, save),
  );

  const importantMail = element('div', 'card settings-card');
  importantMail.append(
    element('h2', 'card-title', 'Wichtige Mails'),
    numberRow('Zeitraum in Tagen', { key: 'mailSinceDays', min: 1, max: 3650, integer: true }, save),
    listEditor('Stichwörter in Betreff und Text (gelten, solange nichts gelernt ist)', 'importantKeywords', 'z. B. Rechnung', save),
    learningRow(feedback),
  );
  const program = element('div', 'card settings-card');
  const versionRow = element('div', 'setting-row');
  const versionText = element('span', 'text-muted', '');
  const showUpdate = (state) => {
    versionText.textContent = updateStatusText(state);
  };
  const checkNow = button('Nach Updates suchen', 'btn-small', async () => {
    checkNow.disabled = true;
    try {
      showUpdate(await window.api.update.check());
    } catch (err) {
      showError(feedback, messageOf(err));
    }
    checkNow.disabled = false;
  });
  const showUpdate2 = button('Update anzeigen', 'btn-small btn-primary', () => showUpdateCard());
  showUpdate2.hidden = true;
  const whatsNew = button('Was ist neu', 'btn-small', () => showChangelog());
  const versionActions = element('span', 'sender-actions');
  versionActions.append(whatsNew, checkNow, showUpdate2);
  versionRow.append(versionText, versionActions);
  program.append(titleWithHelp('Programm', 'updates'), versionRow);
  const offBadge = onUpdateState((state) => {
    if (!root.isConnected) {
      offBadge();
      return;
    }
    showUpdate2.hidden = !needsUpdateBadge(state);
  });
  window.api.update.state().then((state) => {
    showUpdate(state);
    checkNow.hidden = state.status === 'disabled';
  }).catch(() => {});
  const offUpdate = window.api.update.onChange((state) => {
    if (root.isConnected) showUpdate(state);
    else offUpdate();
  });

  root.append(buildLookCard(save), buildHomeCard(save), buildAccountsCard(feedback), importantMail, downloads, program);
}

registerView('settings', {
  title: 'Einstellungen',
  icon: icons.settings,
  async render(container) {
    const root = element('div', 'view');
    container.append(root);
    root.append(element('h1', 'view-title', 'Einstellungen')); // until the settings are loaded
    try {
      current = await window.api.settings.get();
    } catch (err) {
      const feedback = element('div', 'feedback');
      root.append(feedback);
      showError(feedback, messageOf(err));
      return;
    }
    if (root.isConnected) draw(root);
  },
});
