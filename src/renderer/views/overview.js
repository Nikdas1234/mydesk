// Start page: the greeting, what needs attention, the drives, and one number
// tile per area. What of the greeting is shown is chosen in the settings.
import { icons } from '../icons.js';
import { registerView, showView } from '../registry.js';
import { store } from '../store.js';
import { formatBytes } from '../format.js';
import { createProgress, showError } from '../feedback.js';
import { element, sum, count } from '../dom.js';
import { mailTiles } from '../view-logic.js';
import {
  greetingLine, dateLine, summaryText, tipOfDay, todoItems, driveInfo, unusedSince,
} from '../dashboard-logic.js';
import { countUp, stagger } from '../motion.js';
import { loadAccounts } from './mail-shared.js';

// One entry per number tile. `key` is the scan it shows, `view` the view it
// opens. `value(result)` is the number, `format` turns it into text,
// `detail(result)` is the small line below.
export const TILES = [
  {
    id: 'important', view: 'important', key: 'mail', title: 'Wichtige Mails', icon: icons.important,
    value: (r) => mailTiles(r).important, format: (n) => String(Math.round(n)),
    detail: (r) => `${mailTiles(r).unread} ungelesen`,
  },
  {
    id: 'newsletters', view: 'newsletters', key: 'mail', title: 'Newsletter', icon: icons.newsletters,
    value: (r) => mailTiles(r).senders, format: (n) => String(Math.round(n)),
    detail: (r) => count(mailTiles(r).mails, 'Mail', 'Mails'),
  },
  {
    id: 'learned', view: 'sort', key: 'mail', title: 'Gelernt', icon: icons.sort,
    value: (r) => r.learned.important + r.learned.other, format: (n) => String(Math.round(n)),
    detail: (r) => (r.learned.ready ? 'sortiert nach Inhalt' : 'Entscheidungen bisher'),
  },
  {
    id: 'junk', view: 'junk', key: 'junk', title: 'Systemmüll', icon: icons.junk, bytes: true,
    value: (r) => sum(r, 'bytes'), format: formatBytes,
    detail: (r) => count(r.filter((cat) => cat.bytes > 0).length, 'Kategorie', 'Kategorien'),
  },
  {
    id: 'downloads', view: 'downloads', key: 'downloads', title: 'Alte Downloads', icon: icons.downloads, bytes: true,
    value: (r) => sum(r, 'size'), format: formatBytes,
    detail: (r) => count(r.length, 'Eintrag', 'Einträge'),
  },
  {
    id: 'programs', view: 'programs', key: 'programs', title: 'Selten genutzt', icon: icons.programs,
    value: (r) => unusedSince(r, 180, Date.now()), format: (n) => String(Math.round(n)),
    detail: (r) => `von ${count(r.length, 'Programm', 'Programmen')}`,
  },
];
// The wide tiles can be hidden like the number tiles.
export const WIDE_TILES = [{ id: 'todo', title: 'Das steht an' }, { id: 'drives', title: 'Laufwerke' }];

const DISK_KEYS = ['junk', 'downloads', 'programs'];
const KEYS = ['mail', ...DISK_KEYS];
const SCAN_TITLES = {
  mail: 'Postfächer', junk: 'Systemmüll', downloads: 'Alte Downloads', programs: 'Programme',
};

// "Alles prüfen" is a run of several scans; it survives switching views.
let run = { active: false, cancelled: false, current: null };
let redraw = () => {};
// Loaded once per visit of the page; null until they arrive.
let extras = { history: null, drives: null, hidden: [], settings: null };
// Tiles that already showed their number: only a new number counts up.
const shownValues = new Map();
let entranceDone = false;

async function checkAll() {
  // Not while a clean-up runs: its result would describe a state that is just changing.
  if (run.active || store.isCleaning('junk')) return;
  run = { active: true, cancelled: false, current: null };
  redraw();
  // The mailboxes are only checked if one is set up.
  const hasAccounts = (await loadAccounts()).length > 0;
  for (const key of hasAccounts ? KEYS : DISK_KEYS) {
    if (run.cancelled) break;
    run.current = key;
    redraw();
    await store.scan(key);
  }
  run.active = false;
  run.current = null;
  await loadExtras();
  redraw();
}

function cancelAll() {
  run.cancelled = true;
  for (const key of KEYS) store.cancel(key);
}

async function loadExtras() {
  const [history, drives, settings] = await Promise.all([
    window.api.history().catch(() => null),
    window.api.drives().catch(() => []),
    window.api.settings.get().catch(() => null),
  ]);
  extras = { history, drives, hidden: settings?.hiddenTiles ?? [], settings };
  return settings;
}

function buildTile(tile) {
  const result = store.get(tile.key);
  const status = store.getStatus(tile.key);
  const node = element('button', 'tile');
  node.type = 'button';
  const icon = element('span', 'tile-icon');
  icon.innerHTML = tile.icon; // trusted static SVG from icons.js
  const number = element('span', 'stat-number', '–');
  let detail = 'Noch nicht geprüft';
  let failed = false;

  if (status.running) {
    detail = 'Wird geprüft …';
    node.classList.add('is-busy');
  } else if (result !== null) {
    const value = tile.value(result);
    detail = tile.detail(result);
    // Count up only when the number is new, not on every redraw.
    if (shownValues.get(tile.id) === value) number.textContent = tile.format(value);
    else countUp(number, value, tile.format);
    shownValues.set(tile.id, value);
  } else if (status.error) {
    detail = 'Prüfung fehlgeschlagen';
    failed = true;
  }
  node.append(icon, element('span', 'tile-title', tile.title), number,
    element('span', failed ? 'tile-detail is-error' : 'tile-detail', detail));
  node.addEventListener('click', () => showView(tile.view));
  return node;
}

function buildTodo() {
  const card = element('div', 'card tile-wide');
  card.append(element('h2', 'card-title', 'Das steht an'));
  const results = Object.fromEntries(KEYS.map((key) => [key, store.get(key)]));
  const items = todoItems(results, Date.now());
  if (KEYS.every((key) => results[key] === null)) {
    card.append(element('p', 'text-muted', 'Noch nichts geprüft. „Alles prüfen" zeigt, was ansteht.'));
  } else if (items.length === 0) {
    card.append(element('p', 'text-muted', 'Alles erledigt. Im Moment steht nichts an.'));
  } else {
    const list = element('div', 'todo-list');
    for (const item of items) {
      const row = element('button', 'todo-row');
      row.type = 'button';
      row.append(element('span', 'truncate', item.text), element('span', 'todo-action', item.action));
      row.addEventListener('click', () => showView(item.view));
      list.append(row);
    }
    card.append(list);
  }
  return card;
}

function buildDrives() {
  const card = element('div', 'card tile-wide');
  card.append(element('h2', 'card-title', 'Laufwerke'));
  if (extras.drives === null) {
    card.append(element('p', 'text-muted', 'Wird gelesen …'));
    return card;
  }
  for (const drive of extras.drives) {
    const info = driveInfo(drive);
    card.append(element('p', 'drive-label', info.label));
    const track = element('div', 'drive-track');
    const bar = element('div', info.low ? 'drive-bar is-low' : 'drive-bar');
    bar.style.width = `${info.usedPercent}%`;
    track.append(bar);
    card.append(track);
  }
  if (extras.drives.length === 0) card.append(element('p', 'text-muted', 'Keine Laufwerke gefunden.'));
  const freed = extras.history?.freedBytes ?? 0;
  card.append(element('p', 'tile-detail', freed > 0
    ? `Mit MyDesk bisher ${formatBytes(freed)} freigegeben`
    : 'Mit MyDesk bisher noch nichts freigegeben'));
  return card;
}

function draw(root) {
  const runningKey = KEYS.find((key) => store.getStatus(key).running);
  const cleaning = store.isCleaning('junk');
  const busy = run.active || runningKey !== undefined || cleaning;
  // Between two scans of a run no key is running yet; keep naming the current one.
  const shownKey = runningKey ?? (run.active ? run.current : null);
  const progressText = cleaning && shownKey === null ? 'Systemmüll wird bereinigt …' : null;
  const hidden = new Set(extras.hidden);
  root.replaceChildren();

  // Every part of the greeting can be switched off in the settings.
  const home = extras.settings ?? {};
  const now = new Date();
  const hero = element('div', 'hero');
  const hello = element('div', 'hero-hello');
  if (home.homeClock !== false) hello.append(element('p', 'hero-date', dateLine(now)));
  hello.append(element('h1', 'view-title hero-title',
    home.homeGreeting !== false ? greetingLine(now.getHours(), home.userName) : 'Übersicht'));
  if (home.homeSummary !== false) {
    const results = Object.fromEntries(KEYS.map((key) => [key, store.get(key)]));
    hello.append(element('p', 'hero-sub', summaryText(results, extras.history?.lastChecked, now.getTime())));
  }
  const checkButton = element('button', 'btn btn-primary', 'Alles prüfen');
  checkButton.type = 'button';
  checkButton.disabled = busy;
  checkButton.addEventListener('click', checkAll);
  hero.append(hello, checkButton);
  root.append(hero);

  if (home.homeTip !== false) {
    const tip = element('div', 'tip');
    const icon = element('span', 'tip-icon');
    icon.innerHTML = icons.tip; // trusted static SVG from icons.js
    tip.append(icon, element('span', undefined, `Tipp: ${tipOfDay(now)}`));
    root.append(tip);
  }

  const feedback = element('div', 'feedback');
  const errors = KEYS.filter((key) => store.getStatus(key).error).map(
    (key) => `${SCAN_TITLES[key]}: ${store.getStatus(key).error}`,
  );
  if (errors.length > 0) showError(feedback, errors.join(' · '));
  root.append(feedback);

  if (busy) {
    const card = element('div', 'card progress-card');
    card.append(createProgress({
      text: progressText ?? (shownKey ? `Prüfe ${SCAN_TITLES[shownKey]} …` : 'Prüfe …'),
      onCancel: cleaning ? undefined : cancelAll,
    }));
    root.append(card);
  }

  const wide = element('div', 'dash-wide');
  if (!hidden.has('todo')) wide.append(buildTodo());
  if (!hidden.has('drives')) wide.append(buildDrives());
  if (wide.children.length === 1) wide.classList.add('is-single');
  if (wide.children.length > 0) root.append(wide);

  const tiles = element('div', 'tiles dash-tiles');
  for (const tile of TILES) if (!hidden.has(tile.id)) tiles.append(buildTile(tile));
  root.append(tiles);

  // The entrance plays once per program start, not on every redraw.
  if (!entranceDone) {
    entranceDone = true;
    stagger(wide, 70);
    stagger(tiles, 50);
  }
}

registerView('overview', {
  title: 'Übersicht',
  icon: icons.overview,
  render(container) {
    const root = element('div', 'view');
    container.append(root);
    redraw = () => {
      if (root.isConnected) draw(root);
    };
    store.watch(root, KEYS, redraw);
    draw(root);
    // The clock in the greeting keeps running while the page is shown.
    const clock = setInterval(() => {
      if (!root.isConnected) clearInterval(clock);
      else if (root.querySelector('.hero-date')) root.querySelector('.hero-date').textContent = dateLine(new Date());
    }, 10_000);
    loadExtras().then((settings) => {
      redraw();
      // Optional: check everything right after the start, once.
      if (settings?.autoCheckOnStart && !autoChecked) {
        autoChecked = true;
        checkAll();
      }
    });
  },
});

let autoChecked = false;
