import { showView, getViews, getCurrentId, onRegistryChange } from './registry.js';
import { icons } from './icons.js';
import { sandboxLabel } from './view-logic.js';
import { needsUpdateBadge } from './dashboard-logic.js';
import { setMotion, motionAllowed, watchContent } from './motion.js';
import { setStyle } from './appearance.js';
import { startUpdateUi, onUpdateState, showChangelogIfNew } from './update-ui.js';
import './views/overview.js';
import './views/important.js';
import './views/sort.js';
import './views/newsletters.js';
import './views/junk.js';
import './views/downloads.js';
import './views/programs.js';
import './views/settings.js';

// Order of the navigation: overview, the mail group, the storage group.
// A `pinned` group is set apart at the bottom.
const NAV_LAYOUT = [
  { ids: ['overview'] },
  { heading: 'Mail', ids: ['important', 'sort', 'newsletters'] },
  { heading: 'Speicher', ids: ['junk', 'downloads', 'programs'] },
  { ids: ['settings'], pinned: true },
];

let navBuiltFor = '';
let updateWaiting = false;

// Rebuilds the navigation only when the set of views changed; otherwise just
// moves the highlight.
function refreshNav() {
  const nav = document.getElementById('sidebar');
  if (!nav) return;
  const views = getViews();
  const signature = [...views.keys()].join(',');
  if (signature !== navBuiltFor) {
    navBuiltFor = signature;
    buildNav(nav, views);
  }
  updateActiveItem();
}

function setExpanded(expanded) {
  document.body.classList.toggle('nav-open', expanded);
  const toggle = document.querySelector('.sidebar-toggle');
  if (toggle) {
    toggle.title = expanded ? 'Leiste einklappen' : 'Leiste ausklappen';
    toggle.setAttribute('aria-expanded', String(expanded));
  }
  moveMarker();
}

function buildNav(nav, views) {
  nav.replaceChildren();

  // Narrow icon rail by default; this button shows or hides the names.
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'sidebar-toggle';
  toggle.innerHTML = icons.menu; // trusted static SVG from icons.js
  toggle.setAttribute('aria-label', 'Leiste aus- oder einklappen');
  toggle.addEventListener('click', () => {
    const expanded = !document.body.classList.contains('nav-open');
    setExpanded(expanded);
    window.api.settings.set({ sidebarExpanded: expanded }).catch(() => {});
  });
  nav.append(toggle);

  for (const group of NAV_LAYOUT) {
    const present = group.ids.filter((id) => views.has(id));
    if (present.length === 0) continue;
    let target = nav;
    if (group.pinned) {
      target = document.createElement('div');
      target.className = 'sidebar-pinned';
      nav.append(target);
    }
    if (group.heading) {
      const heading = document.createElement('div');
      heading.className = 'sidebar-heading';
      heading.textContent = group.heading;
      target.append(heading);
    }
    for (const id of present) {
      const view = views.get(id);
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'sidebar-item';
      item.dataset.viewId = id;
      item.title = view.title;
      const icon = document.createElement('span');
      icon.className = 'sidebar-icon';
      icon.innerHTML = view.icon; // trusted static SVG from icons.js
      const label = document.createElement('span');
      label.className = 'sidebar-label';
      label.textContent = view.title;
      item.append(icon, label);
      item.addEventListener('click', () => {
        if (id !== getCurrentId()) showView(id);
      });
      target.append(item);
    }
  }
  // The highlight is one element that travels to the active entry.
  const marker = document.createElement('div');
  marker.className = 'sidebar-marker';
  marker.hidden = true;
  nav.append(marker);

  setExpanded(document.body.classList.contains('nav-open'));
  markUpdate();
}

function moveMarker() {
  const nav = document.getElementById('sidebar');
  const marker = nav?.querySelector('.sidebar-marker');
  const active = nav?.querySelector('.sidebar-item.active');
  if (!marker) return;
  if (!active) {
    marker.hidden = true;
    return;
  }
  const top = active.getBoundingClientRect().top - nav.getBoundingClientRect().top + nav.scrollTop;
  // The first placement must not slide in from the top.
  if (marker.hidden) marker.classList.add('is-placing');
  marker.hidden = false;
  marker.style.transform = `translateY(${top}px)`;
  marker.style.height = `${active.offsetHeight}px`;
  requestAnimationFrame(() => marker.classList.remove('is-placing'));
}
window.addEventListener('resize', moveMarker);

function updateActiveItem() {
  const currentId = getCurrentId();
  for (const item of document.querySelectorAll('.sidebar-item')) {
    const active = item.dataset.viewId === currentId;
    item.classList.toggle('active', active);
    if (active) item.setAttribute('aria-current', 'page');
    else item.removeAttribute('aria-current');
  }
  moveMarker();
}

// A dot at the settings entry for as long as an update is waiting.
function markUpdate() {
  const item = document.querySelector('.sidebar-item[data-view-id="settings"]');
  if (!item) return;
  item.classList.toggle('has-dot', updateWaiting);
  item.title = updateWaiting ? 'Einstellungen – Update verfügbar' : 'Einstellungen';
}

onRegistryChange(refreshNav);
refreshNav();

const params = new URLSearchParams(location.search);
const startView = params.get('view');
watchContent(document.getElementById('content'));

// Practice mode: a permanent hint in the title bar, so nobody mistakes it for
// the real thing. In real mode (or if the question fails) nothing is shown.
async function showModeHint() {
  try {
    const label = sandboxLabel(await window.api.info());
    if (!label) return;
    const hint = document.createElement('span');
    hint.className = 'titlebar-sandbox';
    hint.textContent = label;
    hint.title = label;
    document.querySelector('.titlebar')?.append(hint);
  } catch {
    // No hint is better than a broken start.
  }
}

// Start animation: the icon draws itself and turns once, then the page
// appears. Resolves when the splash starts to fade, so the first view comes in
// while it clears. Skipped without motion and for scripted starts (?splash=0).
function runSplash() {
  const splash = document.getElementById('splash');
  if (!splash) return Promise.resolve();
  if (!motionAllowed() || params.get('splash') === '0') {
    splash.remove();
    return Promise.resolve();
  }
  splash.classList.add('play');
  return new Promise((resolve) => {
    setTimeout(() => {
      splash.classList.add('done');
      setTimeout(() => splash.remove(), 350);
      resolve();
    }, 1650);
  });
}

async function start() {
  let settings = null;
  try {
    settings = await window.api.settings.get();
  } catch {
    // defaults apply
  }
  setMotion(settings?.animations !== false);
  setStyle(settings?.style);
  setExpanded(settings?.sidebarExpanded === true);
  showModeHint();
  await runSplash();
  showView(getViews().has(startView) ? startView : 'overview');
  onUpdateState((state) => {
    updateWaiting = needsUpdateBadge(state);
    markUpdate();
  });
  // First what is new in this version, then (if there is one) the next update.
  await showChangelogIfNew();
  startUpdateUi();
}
start();
